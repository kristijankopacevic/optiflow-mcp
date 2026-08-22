// The `PostToolUse` hook entry for matcher `mcp__.*` — reads an MCP tool's
// raw output from stdin, and if it is large enough (`mcpCompression.minOutputBytes`)
// and looks compressible (delegated entirely to `generic.ts`'s heuristics —
// this hook never reimplements shape detection), emits
// `updatedMCPToolOutput`. Otherwise emits a bare `{}` (see pretooluse.ts's
// module header for why this is not `allow()`: `PostToolUse` has no
// permission decision to make at all — `allow`/`deny` only apply to
// `PreToolUse` — so `allow()` would be actively meaningless noise here,
// not just a permission-model risk, but "no opinion" is still correctly a
// bare `{}`, not `hookSpecificOutput.permissionDecision`).

import { pathToFileURL } from "node:url";
import { readHookInput, updateMCPOutput, writeHookOutput, type HookOutput } from "../core/hook-io.js";
import { loadConfig } from "../config/load.js";
import { appendLedger } from "../core/ledger.js";
import { countTokens } from "../core/tokens.js";
import { recordOptimizerToolObservation } from "../optimizer/hooks/lib/capabilities.js";
import { annotateCcrMarkers, genericFilter } from "./filters/generic.js";

export interface McpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * `tool_response` as Claude Code actually sends it, verified by capturing real
 * hook stdin from a live 2.1.235 session: a BARE ARRAY of content blocks.
 *
 * The `{ content: [...] }` object form is also accepted here purely
 * defensively — it is the shape the vendored upstream assumed and the shape
 * this file used to require exclusively, which is why the whole compression
 * path silently no-op'd in production while every fixture-driven test passed.
 * Accepting both costs nothing and means a future contract change in either
 * direction degrades to "no compression" rather than a crash.
 */
export type PostToolUseMcpResponse =
  | McpContentBlock[]
  | { content?: McpContentBlock[]; [key: string]: unknown };

export interface PostToolUseMcpHookInput {
  tool_name?: string;
  tool_response?: PostToolUseMcpResponse;
  /** Present on every hook payload; needed to scope the capability record. */
  session_id?: string;
  /** Identifies the AGENT, so a subagent proves tools for itself only. */
  transcript_path?: string;
}

const MCP_TOOL_MATCHER = /^mcp__/;

/** Extracts the content-block array from either accepted `tool_response` shape. */
export function normalizeToolResponse(
  toolResponse: PostToolUseMcpResponse | undefined
): McpContentBlock[] | null {
  if (Array.isArray(toolResponse)) {
    return toolResponse.length > 0 ? toolResponse : null;
  }
  const content = toolResponse?.content;
  if (Array.isArray(content) && content.length > 0) return content;
  return null;
}

/** Concatenates every text block's `.text`, which is what token/byte-size decisions are based on. */
function extractText(content: McpContentBlock[]): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

export interface PostToolUseMcpDecision {
  compress: boolean;
  reason: string;
}

export function decidePostToolUseMcp(
  input: PostToolUseMcpHookInput,
  loadOptions: { cwd?: string; home?: string } = {}
): PostToolUseMcpDecision {
  if (typeof input.tool_name !== "string" || !MCP_TOOL_MATCHER.test(input.tool_name)) {
    return { compress: false, reason: "not an mcp__* tool call" };
  }

  const content = normalizeToolResponse(input.tool_response);
  if (!content) {
    return { compress: false, reason: "no tool_response content blocks to inspect" };
  }

  const { config } = loadConfig(loadOptions);
  if (!config.mcpCompression.enabled) {
    return { compress: false, reason: "mcpCompression.enabled is false" };
  }

  const text = extractText(content);
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength < config.mcpCompression.minOutputBytes) {
    return {
      compress: false,
      reason: `output is ${byteLength} bytes, below mcpCompression.minOutputBytes (${config.mcpCompression.minOutputBytes})`,
    };
  }

  return { compress: true, reason: "eligible for compression" };
}

/**
 * Ledger module name for this path. Reported separately from the other
 * savings sources because they are different kinds of claim — see
 * `src/cli/commands/savings.ts`.
 */
export const MCP_COMPRESSION_LEDGER_MODULE = "mcp-compression";

export interface BuildHookOutputOptions {
  /**
   * Injected so `buildHookOutput` stays a pure function under test —
   * mirrors `src/chop/wrapper-core.ts`'s `options.writeLedger` exactly.
   * Omitted here and supplied by `runPostToolUseMcp`, which is the real
   * process entry path.
   */
  writeLedger?: typeof appendLedger;
}

export function buildHookOutput(
  input: PostToolUseMcpHookInput,
  decision: PostToolUseMcpDecision,
  options: BuildHookOutputOptions = {}
): HookOutput {
  if (!decision.compress) return {};

  const content = normalizeToolResponse(input.tool_response);
  if (!content) return {};
  const text = extractText(content);
  const filtered = genericFilter({ stdout: text, stderr: "", args: [], exitCode: 0 });

  // Preserve non-text blocks verbatim (e.g. images); replace only the
  // concatenated text with the filtered version, as a single text block —
  // multiple original text blocks are intentionally collapsed into one,
  // since `extractText` already joined them for the size/filter decision.
  //
  // `annotateCcrMarkers` runs here rather than inside the filter: this is
  // the point where text stops being data and becomes model context, and it
  // is the only point at which naming `ccr_retrieve` is useful. See its doc
  // comment for why it cannot live inside `genericFilter`.
  const nonTextBlocks = content.filter((block) => block.type !== "text");
  const replacementText = annotateCcrMarkers(filtered.text);
  const newContent: McpContentBlock[] = [
    { type: "text", text: replacementText },
    ...nonTextBlocks,
  ];

  // Record what this actually saved. Until now every compression path
  // except the chop wrapper saved silently, so `optiflow report` could show
  // what a session SPENT but nothing could show what optiflow SAVED — the
  // single most reasonable question a user asks about this plugin.
  if (options.writeLedger) {
    options.writeLedger({
      module: MCP_COMPRESSION_LEDGER_MODULE,
      command_or_context: input.tool_name ?? "mcp__unknown",
      tokensBefore: countTokens(text),
      tokensAfter: countTokens(replacementText),
      bytesBefore: Buffer.byteLength(text, "utf8"),
      bytesAfter: Buffer.byteLength(replacementText, "utf8"),
    });
  }

  return updateMCPOutput("PostToolUse", newContent);
}

export async function runPostToolUseMcp(
  readInput: () => Promise<PostToolUseMcpHookInput | null>,
  loadOptions: { cwd?: string; home?: string } = {}
): Promise<HookOutput> {
  const input = await readInput();
  if (!input) return {};

  // This hook is the ONLY place in the plugin that sees an MCP tool call
  // actually succeed, which makes it the only honest source of evidence for
  // whether the enforcement layer may name that tool in a refusal. Without
  // it the router denies toward tools a client may not be able to reach --
  // a subagent with a restricted tool list has no MCP access at all, and a
  // denial pointing it at `smart_grep` is a dead end it cannot escape. See
  // src/optimizer/hooks/lib/capabilities.ts.
  recordOptimizerToolObservation(
    input.tool_name,
    input.session_id,
    input.transcript_path ?? null
  );

  const decision = decidePostToolUseMcp(input, loadOptions);
  // The real entry path writes the ledger; buildHookOutput stays pure for tests.
  return buildHookOutput(input, decision, { writeLedger: appendLedger });
}

// ---------------------------------------------------------------------------
// Process entry point (guarded).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const output = await runPostToolUseMcp(() => readHookInput<PostToolUseMcpHookInput>());
  writeHookOutput(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}
