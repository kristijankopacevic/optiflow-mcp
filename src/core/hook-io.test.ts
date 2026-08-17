import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  allow,
  allowWithContext,
  deny,
  readHookInput,
  toCappedJson,
  updateInput,
  updateMCPOutput,
} from "./hook-io.js";

function stdinFrom(text: string): NodeJS.ReadableStream {
  return Readable.from([text]) as unknown as NodeJS.ReadableStream;
}

describe("readHookInput", () => {
  it("parses a well-formed JSON stdin payload", async () => {
    const result = await readHookInput(stdinFrom('{"tool_name":"Bash","tool_input":{"command":"git status"}}'));
    expect(result).toEqual({ tool_name: "Bash", tool_input: { command: "git status" } });
  });

  it("returns null on malformed JSON instead of throwing", async () => {
    const result = await readHookInput(stdinFrom("{not valid json"));
    expect(result).toBeNull();
  });

  it("returns null on empty stdin instead of throwing", async () => {
    const result = await readHookInput(stdinFrom(""));
    expect(result).toBeNull();
  });
});

describe("toCappedJson", () => {
  it("returns plain JSON unchanged when under the cap", () => {
    const value = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
    const json = toCappedJson(value, 10_000);
    expect(json.length).toBeLessThanOrEqual(10_000);
    expect(JSON.parse(json)).toEqual(value);
  });

  it("truncates the longest string field and stays valid JSON when over the cap", () => {
    const value = allowWithContext("PreToolUse", "x".repeat(50_000));
    const json = toCappedJson(value, 10_000);
    expect(json.length).toBeLessThanOrEqual(10_000);
    const parsed = JSON.parse(json); // must not throw: still valid JSON
    expect(parsed.hookSpecificOutput.additionalContext).toContain("chars omitted]");
    expect(parsed.hookSpecificOutput.additionalContext.length).toBeLessThan(50_000);
  });

  it("respects a custom cap", () => {
    const value = allowWithContext("SessionStart", "y".repeat(500));
    const json = toCappedJson(value, 200);
    expect(json.length).toBeLessThanOrEqual(200);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe("hook output builders", () => {
  it("allow() sets permissionDecision to allow", () => {
    expect(allow("PreToolUse")).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
  });

  it("deny() carries the reason", () => {
    expect(deny("PreToolUse", "not on allowlist")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "not on allowlist",
      },
    });
  });

  it("allowWithContext() sets additionalContext", () => {
    expect(allowWithContext("SessionStart", "hello")).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        permissionDecision: "allow",
        additionalContext: "hello",
      },
    });
  });

  it("updateInput() carries updatedInput", () => {
    expect(updateInput("PreToolUse", { command: "optiflow-chop git status" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command: "optiflow-chop git status" },
      },
    });
  });

  it("updateMCPOutput() carries updatedMCPToolOutput", () => {
    expect(updateMCPOutput("PostToolUse", { content: [{ type: "text", text: "ok" }] })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedMCPToolOutput: { content: [{ type: "text", text: "ok" }] },
      },
    });
  });
});
