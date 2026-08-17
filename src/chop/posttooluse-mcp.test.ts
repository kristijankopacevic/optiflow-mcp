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
    JSON.stringify({ chop: { enabled: true, ...(minOutputBytes !== undefined ? { minOutputBytes } : {}) } }),
    "utf8"
  );
}

function mcpInput(toolName: string, text: string): PostToolUseMcpHookInput {
  return { tool_name: toolName, tool_response: { content: [{ type: "text", text }] } };
}

describe("decidePostToolUseMcp", () => {
  it("ignores non-mcp__ tool calls", () => {
    const decision = decidePostToolUseMcp(mcpInput("Bash", "x".repeat(10_000)), { cwd: projectDir, home: homeDir });
    expect(decision.compress).toBe(false);
  });

  it("does nothing when chop is disabled (default)", () => {
    const decision = decidePostToolUseMcp(mcpInput("mcp__example__tool", "x".repeat(10_000)), {
      cwd: projectDir,
      home: homeDir,
    });
    expect(decision.compress).toBe(false);
    expect(decision.reason).toContain("chop.enabled is false");
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
    const content = output.hookSpecificOutput!.updatedMCPToolOutput!.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe("text");
    expect(content[0].text.length).toBeLessThan(largeArray.length);
  });

  it("preserves non-text content blocks verbatim", () => {
    enableChop(0);
    const input: PostToolUseMcpHookInput = {
      tool_name: "mcp__example__tool",
      tool_response: {
        content: [
          { type: "text", text: "x".repeat(500) },
          { type: "image", data: "base64stuff" },
        ],
      },
    };
    const decision = decidePostToolUseMcp(input, { cwd: projectDir, home: homeDir });
    const output = buildHookOutput(input, decision);
    const content = output.hookSpecificOutput!.updatedMCPToolOutput!.content as Array<Record<string, unknown>>;
    expect(content.some((block) => block.type === "image")).toBe(true);
  });

  it("emits a bare {} for the non-compress path", () => {
    const input = mcpInput("Bash", "irrelevant");
    const decision = decidePostToolUseMcp(input, { cwd: projectDir, home: homeDir });
    const output = buildHookOutput(input, decision);
    expect(output).toEqual({});
  });
});
