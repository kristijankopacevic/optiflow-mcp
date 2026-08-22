// Covers the fix for the worst bug this plugin has had: the router denied a
// tool call and told the model to "call smart_grep instead" without ever
// checking that smart_grep was reachable. Against a subagent with a
// restricted tool list (no MCP tools at all) that is a dead end — the agent
// retries, is refused again, and cannot make progress. This did not merely
// fail to save tokens; it blocked work.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  HOOK_MCP_TOOLS,
  optimizerToolFromMcpName,
  optimizerToolsForHook,
  recordOptimizerToolObservation,
} from "./capabilities.js";
import { loadState } from "./policy.js";

let stateDir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), "optiflow-capabilities-"));
  env = { TOKEN_OPTIMIZER_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe("optimizerToolFromMcpName", () => {
  it("matches a plain MCP server namespace", () => {
    expect(optimizerToolFromMcpName("mcp__optiflow-optimizer__smart_read")).toBe("smart_read");
  });

  it("matches the longer plugin-scoped namespace Claude Code actually emits", () => {
    expect(
      optimizerToolFromMcpName("mcp__plugin_optiflow_optiflow-optimizer__smart_grep")
    ).toBe("smart_grep");
  });

  it("rejects a bare name with no mcp__ prefix", () => {
    // Evidence must come from a real MCP call, not a string that looks like one.
    expect(optimizerToolFromMcpName("smart_read")).toBeNull();
  });

  it("rejects tools that are not part of the routing contract", () => {
    expect(optimizerToolFromMcpName("mcp__optiflow-optimizer__ccr_retrieve")).toBeNull();
    expect(optimizerToolFromMcpName("mcp__other__whatever")).toBeNull();
    expect(optimizerToolFromMcpName(undefined)).toBeNull();
  });
});

describe("optimizerToolsForHook", () => {
  it("is UNPROVEN with no evidence — the router must advise, not deny", () => {
    const evidence = optimizerToolsForHook({}, null, env);
    expect(evidence.proven).toBe(false);
  });

  it("still names every tool while unproven, so the suggestion can bootstrap", () => {
    // Returning an empty set here would suppress the suggestion entirely,
    // the tool would never be discovered, and evidence would never arrive.
    const evidence = optimizerToolsForHook({}, null, env);
    expect(evidence.names.size).toBe(HOOK_MCP_TOOLS.length);
    expect(evidence.names.has("smart_grep")).toBe(true);
  });

  it("becomes proven once a tool has actually been observed", () => {
    const state = { optimizerTools: ["smart_read"], optimizerToolsObservedAt: Date.now() };
    const evidence = optimizerToolsForHook({}, state, env);
    expect(evidence.proven).toBe(true);
    expect([...evidence.names]).toEqual(["smart_read"]);
  });

  it("ignores junk recorded in state", () => {
    const evidence = optimizerToolsForHook({}, { optimizerTools: ["nonsense", "smart_glob"] }, env);
    expect([...evidence.names]).toEqual(["smart_glob"]);
  });

  it("treats an explicit operator override as proof", () => {
    const evidence = optimizerToolsForHook({}, null, {
      ...env,
      TOKEN_OPTIMIZER_MCP_CAPABILITIES: "smart_read,smart_grep",
    } as NodeJS.ProcessEnv);
    expect(evidence.proven).toBe(true);
    expect([...evidence.names].sort()).toEqual(["smart_grep", "smart_read"]);
  });

  it("honors an EMPTY override as a deliberate 'this client has none'", () => {
    const evidence = optimizerToolsForHook({}, null, {
      ...env,
      TOKEN_OPTIMIZER_MCP_CAPABILITIES: "",
    } as NodeJS.ProcessEnv);
    expect(evidence.proven).toBe(true);
    expect(evidence.names.size).toBe(0);
  });

  it("accepts the JSON array override form", () => {
    const evidence = optimizerToolsForHook({}, null, {
      ...env,
      TOKEN_OPTIMIZER_MCP_CAPABILITIES: '["smart_edit"]',
    } as NodeJS.ProcessEnv);
    expect([...evidence.names]).toEqual(["smart_edit"]);
  });
});

describe("recordOptimizerToolObservation", () => {
  it("records a real MCP call and flips the evidence to proven", () => {
    expect(
      recordOptimizerToolObservation("mcp__optiflow-optimizer__smart_read", "s1", null, env)
    ).toBe(true);

    const state = loadState("s1", null, env);
    expect(state.optimizerTools).toContain("smart_read");
    expect(optimizerToolsForHook({}, state, env).proven).toBe(true);
  });

  it("ignores anything that is not a routing tool", () => {
    expect(recordOptimizerToolObservation("mcp__something__else", "s1", null, env)).toBe(false);
    expect(recordOptimizerToolObservation("Read", "s1", null, env)).toBe(false);
    expect(loadState("s1", null, env).optimizerTools).toEqual([]);
  });

  it("does not rewrite state for a tool already recorded", () => {
    recordOptimizerToolObservation("mcp__x__smart_read", "s1", null, env);
    expect(recordOptimizerToolObservation("mcp__x__smart_read", "s1", null, env)).toBe(false);
    expect(loadState("s1", null, env).optimizerTools).toEqual(["smart_read"]);
  });

  it("scopes evidence per agent, so a subagent cannot inherit the parent's proof", () => {
    // This is the whole point: the parent session may reach MCP tools while a
    // subagent with a restricted tool list cannot. Proving it for one must
    // never license denials against the other.
    recordOptimizerToolObservation("mcp__x__smart_read", "s1", "/transcripts/parent.jsonl", env);

    const child = loadState("s1", "/transcripts/child.jsonl", env);
    expect(child.optimizerTools).toEqual([]);
    expect(optimizerToolsForHook({}, child, env).proven).toBe(false);
  });

  it("never throws on unusable input", () => {
    expect(() => recordOptimizerToolObservation(null, undefined, null, env)).not.toThrow();
  });
});
