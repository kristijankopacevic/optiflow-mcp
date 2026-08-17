// The `PostToolUse` hook entry for matcher `mcp__.*` — reads an MCP tool's
// raw output from stdin, and if it's large enough (`chop.minOutputBytes`)
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
import { genericFilter } from "./filters/generic.js";

export interface McpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface PostToolUseMcpHookInput {
  tool_name?: string;
  tool_response?: {
    content?: McpContentBlock[];
    [key: string]: unknown;
  };
}

const MCP_TOOL_MATCHER = /^mcp__/;

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

  const content = input.tool_response?.content;
  if (!Array.isArray(content) || content.length === 0) {
    return { compress: false, reason: "no tool_response.content to inspect" };
  }

  const { config } = loadConfig(loadOptions);
  if (!config.chop.enabled) {
    return { compress: false, reason: "chop.enabled is false" };
  }

  const text = extractText(content);
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength < config.chop.minOutputBytes) {
    return { compress: false, reason: `output is ${byteLength} bytes, below chop.minOutputBytes (${config.chop.minOutputBytes})` };
  }

  return { compress: true, reason: "eligible for compression" };
}

export function buildHookOutput(
  input: PostToolUseMcpHookInput,
  decision: PostToolUseMcpDecision
): HookOutput {
  if (!decision.compress) return {};

  const content = input.tool_response?.content as McpContentBlock[];
  const text = extractText(content);
  const filtered = genericFilter({ stdout: text, stderr: "", args: [], exitCode: 0 });

  // Preserve non-text blocks verbatim (e.g. images); replace only the
  // concatenated text with the filtered version, as a single text block —
  // multiple original text blocks are intentionally collapsed into one,
  // since `extractText` already joined them for the size/filter decision.
  const nonTextBlocks = content.filter((block) => block.type !== "text");
  const newContent: McpContentBlock[] = [{ type: "text", text: filtered.text }, ...nonTextBlocks];

  return updateMCPOutput("PostToolUse", { content: newContent });
}

export async function runPostToolUseMcp(
  readInput: () => Promise<PostToolUseMcpHookInput | null>,
  loadOptions: { cwd?: string; home?: string } = {}
): Promise<HookOutput> {
  const input = await readInput();
  if (!input) return {};
  const decision = decidePostToolUseMcp(input, loadOptions);
  return buildHookOutput(input, decision);
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
