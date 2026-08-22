import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHookInput } from "../core/hook-io.js";
import { runPostToolUseMcp } from "./posttooluse-mcp.js";
import { decode } from "../toon/convert.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures/hooks/", import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function stdinFrom(text: string): NodeJS.ReadableStream {
  return Readable.from([text]) as unknown as NodeJS.ReadableStream;
}

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-posttooluse-fixtures-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-posttooluse-fixtures-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe("posttooluse-mcp golden fixture", () => {
  // v3 INVERSION (deliberate): this used to assert that a default install
  // produced NO compression, because the path was gated behind
  // `chop.enabled: false`. That gate was the reason TOON and SmartCrusher
  // were dead on every default install despite both being `enabled: true`.
  // Compressing an MCP tool RESULT does not touch the permission-matching
  // surface that justifies chop's default-off, so it is now on by default.
  it("default config (no file) -> DOES compress the real-shape fixture", async () => {
    const raw = loadFixture("posttooluse-mcp-large-json.json");
    const output = await runPostToolUseMcp(() => readHookInput(stdinFrom(raw)), { cwd: projectDir, home: homeDir });
    const content = output.hookSpecificOutput?.updatedMCPToolOutput as Array<{ text: string }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].text.length).toBeLessThan(raw.length);
  });

  it("mcpCompression.enabled: false -> no updatedMCPToolOutput", async () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ mcpCompression: { enabled: false } }),
      "utf8"
    );
    const raw = loadFixture("posttooluse-mcp-large-json.json");
    const output = await runPostToolUseMcp(() => readHookInput(stdinFrom(raw)), { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});
  });

  // The legacy `{ content: [...] }` shape must still work — see
  // `normalizeToolResponse`. This is the shape the OLD fixture encoded, and
  // the reason the production bug went unnoticed for so long.
  it("legacy object-shaped tool_response still compresses", async () => {
    const raw = loadFixture("posttooluse-mcp-legacy-object-shape.json");
    const output = await runPostToolUseMcp(() => readHookInput(stdinFrom(raw)), { cwd: projectDir, home: homeDir });
    const content = output.hookSpecificOutput?.updatedMCPToolOutput as Array<{ text: string }>;
    expect(Array.isArray(content)).toBe(true);
  });

  it("mcpCompression.enabled: true + low minOutputBytes -> updatedMCPToolOutput compresses the large uniform array", async () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ mcpCompression: { enabled: true, minOutputBytes: 50 } }),
      "utf8"
    );
    const raw = loadFixture("posttooluse-mcp-large-json.json");
    const output = await runPostToolUseMcp(() => readHookInput(stdinFrom(raw)), { cwd: projectDir, home: homeDir });
    const content = output.hookSpecificOutput?.updatedMCPToolOutput as Array<{ type: string; text: string }>;
    expect(content).toBeDefined();

    const originalItems = JSON.parse(
      (JSON.parse(raw) as { tool_response: Array<{ text: string }> }).tool_response[0].text
    );
    expect(content[0].text.length).toBeLessThan(raw.length);

    // Phase 5: `genericFilter`'s uniform-array path now tries TOON first
    // (lossless over the full 30-row array) via its default resolved
    // `toon` config, and only falls back to the Phase-3 head+tail
    // "... N items omitted ..." truncation when TOON is declined. Which of
    // the two actually fires here depends on `genericFilter`'s default
    // config resolution — which reads REAL disk config (this test cannot
    // inject a `toonConfig` through `runPostToolUseMcp`'s public surface),
    // so a user's own `~/.optiflow/config.json` could in principle disable
    // TOON or raise the threshold. Branch on which happened rather than
    // pinning one mechanism, so this test stays correct either way: if
    // TOON was used, round-tripping via `decode` must reproduce every row
    // losslessly; if the truncation fallback fired instead, the marker and
    // omitted-count bookkeeping must still be intact (the pre-Phase-5
    // guarantee).
    if (content[0].text.includes("omitted")) {
      // Truncation fallback fired: still valid JSON, still shorter than the
      // full 30-item array, with an explicit omitted-count marker.
      const parsedBack = JSON.parse(content[0].text);
      expect(Array.isArray(parsedBack)).toBe(true);
      expect(parsedBack.length).toBeLessThan(originalItems.length);
    } else {
      // TOON fired: lossless round-trip of every one of the 30 rows.
      expect(decode(content[0].text)).toEqual(originalItems);
    }
  });
});
