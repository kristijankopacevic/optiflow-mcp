// Live end-to-end proof that MCP tool-result compression actually reaches the
// model — the ONLY test shape that can catch this class of bug.
//
// Why this exists: the compression path silently did nothing in production for
// its entire life while every fixture-driven unit test passed, because the
// fixtures encoded a `tool_response` shape Claude Code does not send. A test
// that feeds our own assumption back to us cannot detect a wrong assumption.
// This one spawns a REAL `claude -p` session, lets Claude Code deliver a real
// MCP tool result through the real hook, and asserts on what the MODEL
// received — not on what the hook printed.
//
// Run via `npm run test:mcp-e2e` (not part of `npm test`: it needs the CLI,
// costs tokens, and takes ~30s). Skips cleanly when `claude` is absent so a
// machine or CI runner without it stays green rather than red.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(repoRoot, "plugin");

/** The exact payload the fixture MCP server returns. Deterministic on purpose. */
function buildRows(): unknown[] {
  return Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    service: "svc-" + String(i % 8).padStart(2, "0"),
    region: ["eu-west-1", "us-east-1", "ap-south-1"][i % 3],
    status: i % 7 === 0 ? "degraded" : "healthy",
    latencyMs: 20 + (i * 7) % 180,
    requests: 1000 + i * 37,
  }));
}

/**
 * Resolves the `claude` executable to an absolute path so the spawn below can
 * run with `shell: false`. This matters: with `shell: true`, Node concatenates
 * argv WITHOUT quoting, so the multi-word prompt is split into separate
 * arguments and the session never runs the intended instruction.
 */
function resolveClaudeBin(): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  const probe = spawnSync(finder, ["claude"], { encoding: "utf8" });
  if (probe.status !== 0) return null;
  const first = (probe.stdout ?? "").split(String.fromCharCode(10)).map((l) => l.trim().replace(String.fromCharCode(13), "")).filter(Boolean)[0];
  if (!first) return null;
  const version = spawnSync(first, ["--version"], { encoding: "utf8" });
  return version.status === 0 ? first : null;
}

const CLAUDE_BIN = resolveClaudeBin();
const AVAILABLE = CLAUDE_BIN !== null;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "optiflow-mcp-e2e-"));

  // A minimal stdio MCP server returning a known uniform JSON array. It
  // resolves @modelcontextprotocol/sdk from the repo, so it lives inside the
  // repo tree; the PLUGIN under test still runs with no node_modules.
  writeFileSync(
    path.join(repoRoot, "tmp-e2e-fixture-server.mjs"),
    `import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const rows = ${JSON.stringify(buildRows())};
const server = new Server({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "get_service_rows",
  description: "Returns 60 uniform service status rows.", inputSchema: { type: "object", properties: {}, required: [] } }] }));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: JSON.stringify(rows) }] }));
await server.connect(new StdioServerTransport());
`,
    "utf8"
  );

  writeFileSync(
    path.join(tmpDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: "node",
          args: [path.join(repoRoot, "tmp-e2e-fixture-server.mjs").split(path.sep).join("/")],
        },
      },
    }),
    "utf8"
  );
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  const fixture = path.join(repoRoot, "tmp-e2e-fixture-server.mjs");
  if (existsSync(fixture)) rmSync(fixture, { force: true });
});

describe.skipIf(!AVAILABLE)("MCP tool-result compression reaches the model", () => {
  it(
    "delivers TOON to the model instead of the original JSON",
    () => {
      const original = JSON.stringify(buildRows());
      const streamPath = path.join(tmpDir, "stream.jsonl");

      const result = spawnSync(
        CLAUDE_BIN as string,
        [
          "-p",
          "--plugin-dir", pluginDir,
          "--mcp-config", path.join(tmpDir, "mcp.json"),
          "--permission-mode", "bypassPermissions",
          "--output-format", "stream-json",
          "--verbose",
          "Call the fixture MCP tool get_service_rows exactly once, then say DONE.",
        ],
        { cwd: tmpDir, encoding: "utf8", shell: false, timeout: 240_000, input: "" }
      );

      expect(result.status, `claude exited ${result.status}: ${result.stderr}`).toBe(0);
      writeFileSync(streamPath, result.stdout ?? "", "utf8");

      // Pull the tool_result exactly as it was delivered into the conversation.
      const delivered: string[] = [];
      for (const line of (result.stdout ?? "").trim().split("\n")) {
        let event: any;
        try { event = JSON.parse(line); } catch { continue; }
        if (event?.type !== "user") continue;
        const content = event.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block?.type !== "tool_result") continue;
          const text = typeof block.content === "string"
            ? block.content
            : (block.content ?? []).map((c: any) => c?.text ?? "").join("");
          if (text) delivered.push(text);
        }
      }

      expect(delivered.length, "no tool_result found in the stream").toBeGreaterThan(0);
      const toolResult = delivered.find((t) => t.includes("svc-00")) ?? delivered[0];

      // The assertion that matters: the model must NOT have received the raw
      // JSON. TOON's header is `[60]{id,service,...}:`.
      expect(toolResult.startsWith("[{"), "model received the ORIGINAL JSON — compression did not reach it").toBe(false);
      expect(toolResult).toMatch(/^\[60\]\{id,service,region,status,latencyMs,requests\}:/);
      expect(toolResult.length).toBeLessThan(original.length);
    },
    300_000
  );
});
