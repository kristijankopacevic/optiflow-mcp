import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHookOutput, decidePostToolUseMcp, type PostToolUseMcpHookInput } from "./posttooluse-mcp.js";

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-posttooluse-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-posttooluse-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

function enableChop(minOutputBytes?: number): void {
  writeFileSync(
    path.join(projectDir, "optiflow.config.json"),
    JSON.stringify({
      mcpCompression: { enabled: true, ...(minOutputBytes !== undefined ? { minOutputBytes } : {}) },
    }),
    "utf8"
  );
}

/** Disables the path explicitly (the default is now `enabled: true`). */
function disableMcpCompression(): void {
  writeFileSync(
    path.join(projectDir, "optiflow.config.json"),
    JSON.stringify({ mcpCompression: { enabled: false } }),
    "utf8"
  );
}

/**
 * The REAL shape Claude Code sends: `tool_response` is a bare array.
 * Verified by capturing live hook stdin from Claude Code 2.1.235.
 */
function mcpInput(toolName: string, text: string): PostToolUseMcpHookInput {
  return { tool_name: toolName, tool_response: [{ type: "text", text }] };
}

/** The legacy object shape, still accepted defensively by `normalizeToolResponse`. */
function mcpInputLegacyShape(toolName: string, text: string): PostToolUseMcpHookInput {
  return { tool_name: toolName, tool_response: { content: [{ type: "text", text }] } };
}

describe("decidePostToolUseMcp", () => {
  it("ignores non-mcp__ tool calls", () => {
    const decision = decidePostToolUseMcp(mcpInput("Bash", "x".repeat(10_000)), { cwd: projectDir, home: homeDir });
    expect(decision.compress).toBe(false);
  });

  it("does nothing when mcpCompression is explicitly disabled", () => {
    disableMcpCompression();
    const decision = decidePostToolUseMcp(mcpInput("mcp__example__tool", "x".repeat(10_000)), {
      cwd: projectDir,
      home: homeDir,
    });
    expect(decision.compress).toBe(false);
    expect(decision.reason).toContain("mcpCompression.enabled is false");
  });

  // v3: this path is ON by default now (split from `chop.enabled`, which stays
  // false for its own trust-boundary reason). Before the split it was gated
  // behind chop and therefore dead on every default install.
  it("compresses by DEFAULT — no config file at all", () => {
    const decision = decidePostToolUseMcp(mcpInput("mcp__example__tool", "x".repeat(10_000)), {
      cwd: projectDir,
      home: homeDir,
    });
    expect(decision.compress).toBe(true);
  });

  it("accepts the real bare-array tool_response shape", () => {
    enableChop(50);
    const decision = decidePostToolUseMcp(mcpInput("mcp__example__tool", "y".repeat(5_000)), {
      cwd: projectDir,
      home: homeDir,
    });
    expect(decision.compress).toBe(true);
  });

  it("still accepts the legacy { content: [...] } shape", () => {
    enableChop(50);
    const decision = decidePostToolUseMcp(mcpInputLegacyShape("mcp__example__tool", "y".repeat(5_000)), {
      cwd: projectDir,
      home: homeDir,
    });
    expect(decision.compress).toBe(true);
  });

  it("does not compress small output even when chop is enabled", () => {
    enableChop(2000);
    const decision = decidePostToolUseMcp(mcpInput("mcp__example__tool", "small"), {
      cwd: projectDir,
      home: homeDir,
    });
    expect(decision.compress).toBe(false);
  });

  it("compresses large output when chop is enabled and above minOutputBytes", () => {
    enableChop(100);
    const decision = decidePostToolUseMcp(mcpInput("mcp__example__tool", "x".repeat(10_000)), {
      cwd: projectDir,
      home: homeDir,
    });
    expect(decision.compress).toBe(true);
  });

  it("does nothing when there is no content to inspect", () => {
    enableChop(0);
    const decision = decidePostToolUseMcp({ tool_name: "mcp__example__tool", tool_response: {} }, {
      cwd: projectDir,
      home: homeDir,
    });
    expect(decision.compress).toBe(false);
  });
});

describe("buildHookOutput", () => {
  it("emits updatedMCPToolOutput with compressed text when eligible", () => {
    enableChop(10);
    const largeArray = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ id: i })));
    const input = mcpInput("mcp__example__tool", largeArray);
    const decision = decidePostToolUseMcp(input, { cwd: projectDir, home: homeDir });
    const output = buildHookOutput(input, decision);
    expect(output.hookSpecificOutput?.updatedMCPToolOutput).toBeDefined();
    const content = output.hookSpecificOutput!.updatedMCPToolOutput as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe("text");
    expect(content[0].text.length).toBeLessThan(largeArray.length);
  });

  it("preserves non-text content blocks verbatim", () => {
    enableChop(0);
    // The text block must be genuinely COMPRESSIBLE (a uniform array), not
    // filler: since the no-op guard landed, a payload the filter cannot
    // improve emits {} and never rewrites at all — which is its own test
    // below.
    const input: PostToolUseMcpHookInput = {
      tool_name: "mcp__example__tool",
      tool_response: [
        { type: "text", text: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ id: i, name: `svc-${i}`, status: "ok" }))) },
        { type: "image", data: "base64stuff" },
      ],
    };
    const decision = decidePostToolUseMcp(input, { cwd: projectDir, home: homeDir });
    const output = buildHookOutput(input, decision);
    const content = output.hookSpecificOutput!.updatedMCPToolOutput as Array<Record<string, unknown>>;
    expect(content.some((block) => block.type === "image")).toBe(true);
  });


  it("emits a bare {} when the filter cannot improve the payload (no-op guard)", () => {
    enableChop(0);
    // Incompressible filler over the size floor: eligible, filtered, and
    // unchanged. Rewriting identical text would collapse the two text blocks
    // into one — a structural change with zero benefit — and write a
    // 0-savings ledger row per call. The guard emits nothing instead.
    const input: PostToolUseMcpHookInput = {
      tool_name: "mcp__example__tool",
      tool_response: [{ type: "text", text: "x".repeat(500) }],
    };
    const decision = decidePostToolUseMcp(input, { cwd: projectDir, home: homeDir });
    expect(decision.compress).toBe(true);
    const rows: unknown[] = [];
    const output = buildHookOutput(input, decision, { writeLedger: (r) => void rows.push(r) });
    expect(output).toEqual({});
    expect(rows).toEqual([]);
  });

  it("emits a bare {} for the non-compress path", () => {
    const input = mcpInput("Bash", "irrelevant");
    const decision = decidePostToolUseMcp(input, { cwd: projectDir, home: homeDir });
    const output = buildHookOutput(input, decision);
    expect(output).toEqual({});
  });
});
