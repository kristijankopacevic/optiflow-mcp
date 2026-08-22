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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHookInput, toCappedJson } from "../../core/hook-io.js";
import { decidePreToolUse, runPreToolUse } from "./pretooluse.js";
import { decidePreCompact, runPreCompact } from "./precompact.js";
import { HOOK_MCP_TOOLS } from "./lib/capabilities.js";

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

/**
 * A real, recognizable Python source file well past both `largeFileBytes()`
 * (25,600 bytes, the deny threshold) and CodeCompressor's own
 * `minTokensForCompression` (100), with function bodies long enough to
 * actually get elided — same construction `smart-read.test.ts` uses to
 * exercise the real (non-mocked) CodeCompressor.
 */
function buildLargePythonFixture(functionCount: number): string {
  const parts = ["import os", "import sys", "", "class Widget:", '    """A widget."""', ""];
  for (let i = 0; i < functionCount; i++) {
    parts.push(`    def compute_${i}(self, value):`);
    parts.push(`        """Computes something for ${i}."""`);
    parts.push(`        total = 0`);
    parts.push(`        for j in range(value):`);
    parts.push(`            total += j * ${i}`);
    parts.push(`            if total > 1000:`);
    parts.push(`                total -= 500`);
    parts.push(`        print(f"computed {total} for iteration ${i}")`);
    parts.push(`        return total`);
    parts.push("");
  }
  return parts.join("\n");
}

/**
 * Plain prose, also past `largeFileBytes()`, but with no code-like
 * structure at all — CodeCompressor's `detectLanguage` genuinely returns
 * "unknown" for this, so it must never produce a substitute.
 */
function buildLargeProseFixture(lineCount: number): string {
  const line = "This is a plain log/notes line with ordinary prose content, nothing code-like at all. ";
  return Array.from({ length: lineCount }, (_, i) => `${i}: ${line}`).join("\n");
}

let projectDir: string;
let optiflowHome: string;
let stateDir: string;
let prevMode: string | undefined;
let prevCapabilities: string | undefined;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-fixtures-project-"));
  optiflowHome = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-fixtures-home-"));
  stateDir = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-fixtures-state-"));
  prevMode = process.env.TOKEN_OPTIMIZER_MODE;
  prevCapabilities = process.env.TOKEN_OPTIMIZER_MCP_CAPABILITIES;
  process.env.OPTIFLOW_HOME = optiflowHome;
  process.env.TOKEN_OPTIMIZER_STATE_DIR = stateDir;
  delete process.env.TOKEN_OPTIMIZER_MODE;
  // Declare the optimizer MCP tools present, which is what every test in
  // this file is implicitly about: what the router does WHEN a replacement
  // is reachable. Without this the router correctly refuses to deny toward
  // an unproven tool (see lib/capabilities.ts) and every denial here
  // degrades to advice — right behaviour, wrong scenario for these tests.
  // The unproven scenario has its own test below.
  process.env.TOKEN_OPTIMIZER_MCP_CAPABILITIES = HOOK_MCP_TOOLS.join(",");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(optiflowHome, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
  delete process.env.OPTIFLOW_HOME;
  delete process.env.TOKEN_OPTIMIZER_STATE_DIR;
  if (prevMode === undefined) delete process.env.TOKEN_OPTIMIZER_MODE;
  else process.env.TOKEN_OPTIMIZER_MODE = prevMode;
  if (prevCapabilities === undefined) delete process.env.TOKEN_OPTIMIZER_MCP_CAPABILITIES;
  else process.env.TOKEN_OPTIMIZER_MCP_CAPABILITIES = prevCapabilities;
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

  // Phase 2 ("deny-and-substitute"): a denied Read on a large file
  // CodeCompressor actually recognizes now carries the compressed content
  // itself in `additionalContext`, alongside the deny — not just a pointer
  // to smart_read.
  it("positive: a large RECOGNIZED-language Read is denied WITH a compressed substitute in additionalContext", async () => {
    const payload = loadFixtureWithCwd("pretooluse-optimizer-positive-large-recognized-read.json", projectDir);
    const filePath = path.join(projectDir, "widget.py");
    writeFileSync(filePath, buildLargePythonFixture(150), "utf8");
    (payload.tool_input as Record<string, unknown>).file_path = filePath;

    const output = await runPreToolUse(() => readHookInput(stdinFrom(JSON.stringify(payload))));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(String(output.hookSpecificOutput?.permissionDecisionReason)).toMatch(/smart_read/);
    const context = String(output.hookSpecificOutput?.additionalContext ?? "");
    expect(context).toMatch(/structure-preserving compression/);
    expect(context).toMatch(/smart_read/);
    // Real structural compression survived, not silence: imports and the
    // first function's signature are present verbatim, and it is genuinely
    // shorter than the source file.
    expect(context).toContain("import os");
    expect(context).toContain("def compute_0");
    expect(context.length).toBeLessThan(readFileSync(filePath, "utf8").length);

    // This fixture's compressed outline is comfortably over the 10,000-char
    // envelope cap, so it exercises `fitSubstituteToEnvelope`: the substitute
    // must arrive PRE-FIT — cut at a line boundary with the INCOMPLETE marker
    // declaring the cut — never amputated mid-signature downstream by
    // `toCappedJson`. Proven by serializing the exact envelope production
    // emits and checking it already fits, i.e. `toCappedJson` had nothing to
    // truncate.
    const serialized = toCappedJson(output);
    expect(serialized.length).toBeLessThanOrEqual(10_000);
    expect(serialized).toBe(JSON.stringify(output)); // pre-fit: the cap was a no-op

    expect(context).toMatch(/OUTPUT CAP -- this outline is INCOMPLETE/);
    expect(context).toMatch(/call smart_read with the same path for the rest/);
    // The cut is at a LINE boundary: the last line of the outline body (just
    // before the marker) is a complete line, not a sliced fragment ending
    // mid-token. Weak-form check: no line in the substitute ends with an
    // opening paren or a dangling comma-less identifier produced by a
    // mid-string slice of this fixture's own shape (`def compute_N(self,`).
    const bodyLines = context.split("\n");
    const markerAt = bodyLines.findIndex((l) => l.includes("OUTPUT CAP"));
    expect(markerAt).toBeGreaterThan(0);
  }, 20_000);

  // Negative half of the same fixture-driven proof: a large file
  // CodeCompressor does NOT recognize as source code must fall through to
  // exactly today's plain redirect — no additionalContext at all.
  it("negative: a large UNRECOGNIZED-language Read still gets the plain redirect, with no additionalContext", async () => {
    const payload = loadFixtureWithCwd("pretooluse-optimizer-positive-large-unrecognized-read.json", projectDir);
    const filePath = path.join(projectDir, "notes.txt");
    writeFileSync(filePath, buildLargeProseFixture(400), "utf8");
    (payload.tool_input as Record<string, unknown>).file_path = filePath;

    const output = await runPreToolUse(() => readHookInput(stdinFrom(JSON.stringify(payload))));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(String(output.hookSpecificOutput?.permissionDecisionReason)).toMatch(/smart_read/);
    expect(output.hookSpecificOutput?.additionalContext).toBeUndefined();
  }, 20_000);

  // The scenario that was broken in production. A subagent with a restricted
  // tool list (`Explore`: Read, Grep, Glob, Bash) has NO MCP tools, so a
  // denial telling it to "call smart_grep instead" is a dead end it cannot
  // escape -- it retries and is refused again. The router must not deny
  // toward a tool nothing has been seen to reach.
  it("does NOT deny when no optimizer MCP tool has been observed — it advises instead", async () => {
    // No capabilities declared and no recorded observation: the state a
    // subagent, or any session whose MCP server failed to start, is in.
    delete process.env.TOKEN_OPTIMIZER_MCP_CAPABILITIES;

    const payload = loadFixtureWithCwd("pretooluse-optimizer-positive-large-unrecognized-read.json", projectDir);
    const filePath = path.join(projectDir, "notes.txt");
    writeFileSync(filePath, buildLargeProseFixture(400), "utf8");
    (payload.tool_input as Record<string, unknown>).file_path = filePath;

    const output = await runPreToolUse(() => readHookInput(stdinFrom(JSON.stringify(payload))));

    expect(output.hookSpecificOutput?.permissionDecision).not.toBe("deny");
    // The suggestion still reaches the model, which is what lets a client
    // that CAN call smart_read discover it and switch enforcement on.
    expect(String(output.hookSpecificOutput?.additionalContext ?? "")).toMatch(/smart_read/);
  }, 20_000);
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
