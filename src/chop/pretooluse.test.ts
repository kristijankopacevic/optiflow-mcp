import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHookOutput, decidePreToolUse, runPreToolUse, type PreToolUseHookInput } from "./pretooluse.js";

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-pretooluse-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-pretooluse-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

function enableChop(): void {
  writeFileSync(path.join(projectDir, "optiflow.config.json"), JSON.stringify({ chop: { enabled: true } }), "utf8");
}

function bashInput(command: string): PreToolUseHookInput {
  return { tool_name: "Bash", tool_input: { command } };
}

describe("decidePreToolUse — chop.enabled default (false)", () => {
  it("never rewrites when chop.enabled is false, even for an otherwise-eligible command", () => {
    const decision = decidePreToolUse(bashInput("git status"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(false);
    expect(decision.reason).toContain("chop.enabled is false");
  });
});

describe("decidePreToolUse — with chop.enabled: true", () => {
  beforeEach(enableChop);

  it("rewrites an eligible simple command (git status)", () => {
    const decision = decidePreToolUse(bashInput("git status"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(true);
  });

  it("does NOT rewrite a compound command (cd src && npm test)", () => {
    const decision = decidePreToolUse(bashInput("cd src && npm test"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(false);
  });

  it("does NOT rewrite a piped command (git log | head -20)", () => {
    const decision = decidePreToolUse(bashInput("git log | head -20"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(false);
  });

  it("does NOT rewrite a redirected command (git status > out.txt)", () => {
    const decision = decidePreToolUse(bashInput("git status > out.txt"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(false);
  });

  it("does NOT rewrite command substitution (echo `date`)", () => {
    const decision = decidePreToolUse(bashInput("echo `date`"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(false);
  });

  it("does NOT rewrite an excluded command (npm run build)", () => {
    const decision = decidePreToolUse(bashInput("npm run build"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(false);
    expect(decision.reason).toContain("excludeCommands");
  });

  it("does NOT rewrite an excluded command (npm test)", () => {
    const decision = decidePreToolUse(bashInput("npm test"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(false);
  });

  it("does NOT rewrite a binary not on the allowlist", () => {
    const decision = decidePreToolUse(bashInput("curl https://example.com"), { cwd: projectDir, home: homeDir });
    expect(decision.rewrite).toBe(false);
  });

  it("ignores non-Bash tool calls entirely, even with an eligible-looking command string", () => {
    for (const toolName of ["Read", "Grep", "Glob", "Edit", "Write"]) {
      const decision = decidePreToolUse(
        { tool_name: toolName, tool_input: { command: "git status", file_path: "x" } },
        { cwd: projectDir, home: homeDir }
      );
      expect(decision.rewrite).toBe(false);
      expect(decision.reason).toContain("not a Bash tool call");
    }
  });
});

describe("buildHookOutput", () => {
  beforeEach(enableChop);

  it("emits updatedInput with the command prefixed, preserving other tool_input keys", () => {
    const input: PreToolUseHookInput = { tool_name: "Bash", tool_input: { command: "git status", timeout: 5000 } };
    const decision = decidePreToolUse(input, { cwd: projectDir, home: homeDir });
    const output = buildHookOutput(input, decision);
    expect(output.hookSpecificOutput?.updatedInput).toEqual({
      command: "optiflow-chop git status",
      timeout: 5000,
    });
  });

  it("emits a bare {} (not permissionDecision: allow) for the non-rewrite path", () => {
    const input = bashInput("cd src && npm test");
    const decision = decidePreToolUse(input, { cwd: projectDir, home: homeDir });
    const output = buildHookOutput(input, decision);
    expect(output).toEqual({});
    expect(output.hookSpecificOutput).toBeUndefined();
  });
});

describe("runPreToolUse — end-to-end via a fixture-style stdin payload", () => {
  beforeEach(enableChop);

  it("positive fixture: large git status output scenario still just rewrites the command (output isn't known yet at PreToolUse time)", async () => {
    const payload: PreToolUseHookInput = { tool_name: "Bash", tool_input: { command: "git status" } };
    const output = await runPreToolUse(async () => payload, { cwd: projectDir, home: homeDir });
    expect(output.hookSpecificOutput?.updatedInput?.command).toBe("optiflow-chop git status");
  });

  it("negative fixture: null/malformed stdin resolves to a bare {} without throwing", async () => {
    const output = await runPreToolUse(async () => null, { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});
  });
});
