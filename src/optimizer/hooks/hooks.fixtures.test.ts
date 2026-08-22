// Golden-fixture tests for the merged optimizer's PreToolUse/PreCompact
// enforcement hooks (v2 Phase 5b), mirroring `src/chop/pretooluse.fixtures.test.ts`'s
// pattern (pipe a real stdin payload through the exact `readHookInput` path a
// real invocation uses).
//
// SANDBOXING: `mode()`/`loadState()` read `TOKEN_OPTIMIZER_MODE`/
// `TOKEN_OPTIMIZER_STATE_DIR` directly from `process.env` (see
// `lib/policy.ts`'s header — session state is deliberately NOT routed
// through `OPTIFLOW_HOME`, it's vendor's own ephemeral scratch convention).
// Every test below sets `TOKEN_OPTIMIZER_STATE_DIR` to a fresh temp dir so
// no real per-user scratch state is ever touched, and `OPTIFLOW_HOME` for
// the wiki/analytics side (`src/optimizer/paths.ts`'s `getOptimizerHome()`).
// The fixtures' own `cwd` ("/PLACEHOLDER/PROJECT") is overwritten to a fresh
// project temp dir per test, same technique the handoff/chop fixture tests
// already use.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHookInput } from "../../core/hook-io.js";
import { decidePreToolUse, runPreToolUse } from "./pretooluse.js";
import { decidePreCompact, runPreCompact } from "./precompact.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/hooks/", import.meta.url));

function loadFixtureWithCwd(name: string, cwd: string): Record<string, unknown> {
  const raw = readFileSync(path.join(FIXTURES_DIR, name), "utf8");
  const parsed = JSON.parse(raw);
  parsed.cwd = cwd;
  return parsed;
}

function stdinFrom(text: string): NodeJS.ReadableStream {
  return Readable.from([text]) as unknown as NodeJS.ReadableStream;
}

let projectDir: string;
let optiflowHome: string;
let stateDir: string;
let prevMode: string | undefined;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-fixtures-project-"));
  optiflowHome = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-fixtures-home-"));
  stateDir = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-fixtures-state-"));
  prevMode = process.env.TOKEN_OPTIMIZER_MODE;
  process.env.OPTIFLOW_HOME = optiflowHome;
  process.env.TOKEN_OPTIMIZER_STATE_DIR = stateDir;
  delete process.env.TOKEN_OPTIMIZER_MODE;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(optiflowHome, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
  delete process.env.OPTIFLOW_HOME;
  delete process.env.TOKEN_OPTIMIZER_STATE_DIR;
  if (prevMode === undefined) delete process.env.TOKEN_OPTIMIZER_MODE;
  else process.env.TOKEN_OPTIMIZER_MODE = prevMode;
});

describe("decidePreToolUse", () => {
  it("fails open on a null payload", async () => {
    expect(await decidePreToolUse(null)).toEqual({});
  });

  it("fails open (empty {}) on a payload with no tool_name", async () => {
    expect(await decidePreToolUse({})).toEqual({});
  });

  it("positive: Grep is always redirected toward smart_grep (no threshold, unlike Read)", async () => {
    const payload = loadFixtureWithCwd("pretooluse-optimizer-positive-grep.json", projectDir);
    const output = await runPreToolUse(() => readHookInput(stdinFrom(JSON.stringify(payload))));
    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(String(output.hookSpecificOutput?.permissionDecisionReason)).toMatch(/smart_grep/);
  });

  it("negative: Read on a nonexistent/tiny file is allowed (below the refusal floor, no state to redirect from)", async () => {
    const payload = loadFixtureWithCwd("pretooluse-optimizer-negative-small-read.json", projectDir);
    const output = await runPreToolUse(() => readHookInput(stdinFrom(JSON.stringify(payload))));
    expect(output).toEqual({});
  });

  it("TOKEN_OPTIMIZER_MODE=off disables enforcement entirely, even for an otherwise-denied call", async () => {
    process.env.TOKEN_OPTIMIZER_MODE = "off";
    const payload = loadFixtureWithCwd("pretooluse-optimizer-positive-grep.json", projectDir);
    const output = await runPreToolUse(() => readHookInput(stdinFrom(JSON.stringify(payload))));
    expect(output).toEqual({});
  });

  it("TOKEN_OPTIMIZER_MODE=advise turns a deny into non-blocking additionalContext", async () => {
    process.env.TOKEN_OPTIMIZER_MODE = "advise";
    const payload = loadFixtureWithCwd("pretooluse-optimizer-positive-grep.json", projectDir);
    const output = await runPreToolUse(() => readHookInput(stdinFrom(JSON.stringify(payload))));
    expect(output.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(String(output.hookSpecificOutput?.additionalContext)).toMatch(/smart_grep/);
  });
});

describe("decidePreCompact", () => {
  it("fails open on a null payload", () => {
    expect(decidePreCompact(null)).toEqual({});
  });

  it("returns {} when the session has no recorded reads yet (the common case)", async () => {
    const raw = loadFixtureWithCwd("precompact-basic.json", projectDir);
    raw.session_id = "sess-optimizer-precompact-fresh";
    const output = await runPreCompact(() => readHookInput(stdinFrom(JSON.stringify(raw))));
    expect(output).toEqual({});
  });

  it("does not throw once PreToolUse has populated session state for this session_id", async () => {
    const sessionId = "sess-optimizer-precompact-populated";

    // Populate state.seen via two allowed Read calls (same session_id, same
    // TOKEN_OPTIMIZER_STATE_DIR) before compacting — proves the PreToolUse ->
    // PreCompact state handoff at least runs end-to-end without crashing.
    for (const fileName of ["a.txt", "b.txt"]) {
      const readPayload = loadFixtureWithCwd("pretooluse-optimizer-negative-small-read.json", projectDir);
      readPayload.session_id = sessionId;
      (readPayload.tool_input as Record<string, unknown>).file_path = path.join(projectDir, fileName);
      const out = await runPreToolUse(() => readHookInput(stdinFrom(JSON.stringify(readPayload))));
      expect(out).toEqual({});
    }

    const compactPayload = loadFixtureWithCwd("precompact-basic.json", projectDir);
    compactPayload.session_id = sessionId;
    const output = await runPreCompact(() => readHookInput(stdinFrom(JSON.stringify(compactPayload))));
    // Either {} or a systemMessage nudge are both valid — this test's job is
    // proving the co-occurrence/clearSeen/forecast path runs without
    // throwing once there's real state to act on, not pinning the exact
    // nudge copy (see precompact.ts's header on what's ported this checkpoint).
    expect(output).toBeTypeOf("object");
  });
});
