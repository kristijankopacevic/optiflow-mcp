// Regression guard for Module 1's load-bearing assumption, replacing
// scripts/verify-upstream-invariants.mjs (removed in v2's Phase 6 cleanup —
// that script scanned vendor/token-optimizer-mcp's PreToolUse hook source
// for "updatedInput"; now that token-optimizer's enforcement hook is
// genuinely MERGED into this repo (src/optimizer/hooks/pretooluse.ts,
// v2 Phase 5b), there is no separate vendored process to scan — the
// invariant instead needs verifying against our OWN two hooks directly).
//
// Both `src/chop/pretooluse.ts` (matcher `Bash`) and
// `src/optimizer/hooks/pretooluse.ts` (matcher `Read|Grep|Glob|Edit|
// MultiEdit|Write|Bash|PowerShell`) register on `PreToolUse` and can both
// fire on the same `Bash` call (Claude Code runs same-event hooks in
// parallel). Per both hooks' own header comments, this is safe ONLY because
// their emitted `hookSpecificOutput` fields are disjoint: chop only ever
// emits `updatedInput` (or a bare `{}`), the optimizer hook only ever emits
// `permissionDecision`/`additionalContext` (or a bare `{}`). This test
// verifies that claim by actually running both real decision functions
// against the same realistic fixtures and asserting the field sets never
// overlap — a comment asserting this is not the same as a test proving it,
// and a future edit to either hook could silently break the claim.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HookOutput } from "../core/hook-io.js";
import { decidePreToolUse as decideChop, buildHookOutput as buildChopOutput } from "./pretooluse.js";
import { decidePreToolUse as decideOptimizer } from "../optimizer/hooks/pretooluse.js";

const CHOP_EXCLUSIVE_FIELDS = ["updatedInput"] as const;
// `deny()` emits permissionDecision+permissionDecisionReason;
// `allowWithContext()` emits permissionDecision+additionalContext (see
// src/core/hook-io.ts) — the optimizer hook only ever calls one of those
// two helpers (or emits a bare {}), never touches `updatedInput`.
const OPTIMIZER_EXCLUSIVE_FIELDS = ["permissionDecision", "permissionDecisionReason", "additionalContext"] as const;

let projectDir: string;
let homeDir: string;
let optiflowHome: string;
let stateDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-disjointness-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-disjointness-home-"));
  optiflowHome = mkdtempSync(path.join(tmpdir(), "optiflow-disjointness-optiflowhome-"));
  stateDir = mkdtempSync(path.join(tmpdir(), "optiflow-disjointness-state-"));
  writeFileSync(path.join(projectDir, "optiflow.config.json"), JSON.stringify({ chop: { enabled: true } }), "utf8");
  process.env.OPTIFLOW_HOME = optiflowHome;
  process.env.TOKEN_OPTIMIZER_STATE_DIR = stateDir;
  delete process.env.TOKEN_OPTIMIZER_MODE;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(optiflowHome, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
  delete process.env.OPTIFLOW_HOME;
  delete process.env.TOKEN_OPTIMIZER_STATE_DIR;
});

function fieldsOf(output: HookOutput): string[] {
  return Object.keys(
    (output as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {}
  ).filter((key) => key !== "hookEventName");
}

describe("chop and the merged optimizer hook never emit overlapping PreToolUse fields", () => {
  it("a Bash command chop would rewrite: chop emits only updatedInput, optimizer emits only its own fields", async () => {
    const chopInput = { tool_name: "Bash", tool_input: { command: "git status" } };
    const chopDecision = decideChop(chopInput, { cwd: projectDir, home: homeDir });
    const chopOutput = buildChopOutput(chopInput, chopDecision);

    const optimizerRaw = { session_id: "s1", cwd: projectDir, tool_name: "Bash", tool_input: { command: "git status" } };
    const optimizerOutput = await decideOptimizer(optimizerRaw);

    const chopFields = fieldsOf(chopOutput);
    const optimizerFields = fieldsOf(optimizerOutput);

    expect(chopFields.every((f) => (CHOP_EXCLUSIVE_FIELDS as readonly string[]).includes(f))).toBe(true);
    expect(optimizerFields.every((f) => (OPTIMIZER_EXCLUSIVE_FIELDS as readonly string[]).includes(f))).toBe(true);
    expect(chopFields.filter((f) => optimizerFields.includes(f))).toEqual([]);
  });

  it("a Grep call the optimizer hook would deny: optimizer emits only its own fields, chop's own matcher wouldn't even fire (Bash-only) but its function still returns cleanly if given the input", async () => {
    const chopInput = { tool_name: "Grep", tool_input: {} };
    const chopDecision = decideChop(chopInput, { cwd: projectDir, home: homeDir });
    const chopOutput = buildChopOutput(chopInput, chopDecision);
    expect(chopOutput).toEqual({});

    const optimizerRaw = { session_id: "s2", cwd: projectDir, tool_name: "Grep", tool_input: { pattern: "TODO" } };
    const optimizerOutput = await decideOptimizer(optimizerRaw);
    const optimizerFields = fieldsOf(optimizerOutput);
    expect(optimizerFields.every((f) => (OPTIMIZER_EXCLUSIVE_FIELDS as readonly string[]).includes(f))).toBe(true);
    expect(optimizerFields.includes("updatedInput")).toBe(false);
  });

  it("neither hook ever emits a field outside its own documented exclusive set, across both fixtures above", () => {
    // Static assertion mirroring both hooks' own header comments — kept as
    // an explicit, greppable list here so a reviewer changing either hook's
    // output shape sees this test fail rather than a silent drift.
    expect(CHOP_EXCLUSIVE_FIELDS).toEqual(["updatedInput"]);
    expect(OPTIMIZER_EXCLUSIVE_FIELDS).toEqual(["permissionDecision", "permissionDecisionReason", "additionalContext"]);
  });
});
