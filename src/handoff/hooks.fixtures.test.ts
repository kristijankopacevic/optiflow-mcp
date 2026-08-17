// Golden-fixture tests for Module 4's hook entries, mirroring
// `src/chop/pretooluse.fixtures.test.ts`'s pattern (pipe a real stdin
// payload through the exact `readHookInput` path a real invocation uses),
// PLUS one real `spawnSync` of the actual bundled `.mjs` per event, proving
// the esbuild output works end-to-end, not just the pre-bundle TS source.
//
// REPO-POLLUTION GUARD: `resolveCheckpointDir` walks up from `cwd` via
// `findProjectRoot` looking for a `.git`/`optiflow.config.json` marker, and
// falls back to `cwd` itself if it reaches the filesystem root first. The
// fixtures on disk carry a placeholder `cwd` ("/PLACEHOLDER/PROJECT") for
// exactly this reason: every test below overwrites `cwd` to a fresh
// `mkdtempSync` project directory (which also gets its own
// `optiflow.config.json` written into it, doubling as the project-root
// marker AND the config file) before feeding the fixture as stdin — the
// same technique `pretooluse.fixtures.test.ts`'s `enableChop()` already
// uses. Nothing here can write outside that temp directory.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHookInput } from "../core/hook-io.js";
import { resolveCheckpointDir } from "./checkpoint.js";
import { findLatestCheckpoint, loadCheckpoint } from "./restore.js";
import { runActivityHook } from "./activity-hook.js";
import { runPreCompactHook } from "./precompact-hook.js";
import { runSessionEndHook } from "./sessionend-hook.js";
import { readActivityBeacon } from "../statusline/io.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures/hooks/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HOOKS_DIR = path.join(REPO_ROOT, "plugin", "hooks");

function loadFixtureWithCwd(name: string, cwd: string): string {
  const raw = readFileSync(path.join(FIXTURES_DIR, name), "utf8");
  const parsed = JSON.parse(raw);
  parsed.cwd = cwd;
  return JSON.stringify(parsed);
}

function stdinFrom(text: string): NodeJS.ReadableStream {
  return Readable.from([text]) as unknown as NodeJS.ReadableStream;
}

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-handoff-fixtures-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-handoff-fixtures-home-"));
  // Doubles as the project-root marker for findProjectRoot AND the config file.
  writeFileSync(path.join(projectDir, "optiflow.config.json"), JSON.stringify({ handoff: { enabled: true } }), "utf8");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe("PreCompact fixture — in-process", () => {
  it("precompact-basic.json writes a real checkpoint file under the temp project dir", async () => {
    const raw = loadFixtureWithCwd("precompact-basic.json", projectDir);
    const output = await runPreCompactHook(() => readHookInput(stdinFrom(raw)), { cwd: projectDir, home: homeDir });
    expect(output.systemMessage).toContain("checkpoint saved");

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    const filePath = findLatestCheckpoint(dir);
    expect(filePath).not.toBeNull();
    expect(path.dirname(filePath!).startsWith(projectDir)).toBe(true);
    expect(loadCheckpoint(filePath!)?.sessionId).toBe("sess-precompact-fixture-1");
  });
});

describe("SessionEnd fixture — in-process", () => {
  it("sessionend-basic.json writes a real checkpoint file under the temp project dir", async () => {
    const raw = loadFixtureWithCwd("sessionend-basic.json", projectDir);
    const output = await runSessionEndHook(() => readHookInput(stdinFrom(raw)), { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    const filePath = findLatestCheckpoint(dir);
    expect(filePath).not.toBeNull();
    expect(loadCheckpoint(filePath!)?.sessionId).toBe("sess-sessionend-fixture-1");
  });
});

describe("PreToolUse activity-beacon fixture — in-process", () => {
  it("pretooluse-activity-read.json writes the activity beacon for a non-Bash tool", async () => {
    const raw = loadFixtureWithCwd("pretooluse-activity-read.json", projectDir);
    const output = await runActivityHook(() => readHookInput(stdinFrom(raw)), { home: homeDir, now: 4242 });
    expect(output).toEqual({});
    expect(readActivityBeacon({ home: homeDir })).toEqual({ tool: "Read", timestamp: 4242 });
  });
});

// ---------------------------------------------------------------------------
// Real spawnSync against the actual bundled .mjs — proves the esbuild output
// works end-to-end (module resolution, ESM interop, etc.), not just the
// pre-bundle TS source the tests above exercise. Skipped gracefully if the
// build hasn't been run yet (these files are committed build artifacts, but
// a fresh checkout without `npm run build` shouldn't fail the whole suite).
// ---------------------------------------------------------------------------

/**
 * Spawns the real bundled hook script. Sets the CHILD PROCESS's actual
 * working directory to `cwd` (not just the fixture's `cwd` field) —
 * `resolveCheckpointDir`/`loadConfig` inside the hook resolve against
 * `process.cwd()` when no explicit `loadOptions.cwd` is passed (which is
 * exactly what a real spawned hook process does: Claude Code launches hook
 * commands with the project directory as their actual cwd, so
 * `process.cwd()` already IS the project dir in production — this mirrors
 * that, rather than relying on the fixture payload's `cwd` field, which
 * only flows into the checkpoint's own `cwd`/git-info fields).
 * `OPTIFLOW_HOME` is honored by `getOptiflowHome()` for the home-dir side.
 */
function runBuiltHook(scriptName: string, fixtureName: string, cwd: string, home: string): { stdout: string; status: number | null } {
  const scriptPath = path.join(HOOKS_DIR, scriptName);
  const raw = loadFixtureWithCwd(fixtureName, cwd);
  const stdout = execFileSync(process.execPath, [scriptPath], {
    input: raw,
    encoding: "utf8",
    cwd,
    env: { ...process.env, OPTIFLOW_HOME: home },
  });
  return { stdout, status: 0 };
}

describe("Real spawnSync against the bundled .mjs hooks", () => {
  it("precompact-handoff.mjs writes a checkpoint end-to-end", () => {
    const scriptPath = path.join(HOOKS_DIR, "precompact-handoff.mjs");
    if (!existsSync(scriptPath)) {
      console.warn("[hooks.fixtures.test] Skipping: run `npm run build` first to produce plugin/hooks/precompact-handoff.mjs");
      return;
    }

    const { stdout } = runBuiltHook("precompact-handoff.mjs", "precompact-basic.json", projectDir, homeDir);
    const parsed = JSON.parse(stdout);
    expect(parsed.systemMessage).toContain("checkpoint saved");

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    const filePath = findLatestCheckpoint(dir);
    expect(filePath).not.toBeNull();
    expect(loadCheckpoint(filePath!)?.sessionId).toBe("sess-precompact-fixture-1");
  });

  it("sessionend-handoff.mjs writes a checkpoint end-to-end", () => {
    const scriptPath = path.join(HOOKS_DIR, "sessionend-handoff.mjs");
    if (!existsSync(scriptPath)) {
      console.warn("[hooks.fixtures.test] Skipping: run `npm run build` first to produce plugin/hooks/sessionend-handoff.mjs");
      return;
    }

    const { stdout } = runBuiltHook("sessionend-handoff.mjs", "sessionend-basic.json", projectDir, homeDir);
    expect(JSON.parse(stdout)).toEqual({});

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    const filePath = findLatestCheckpoint(dir);
    expect(filePath).not.toBeNull();
    expect(loadCheckpoint(filePath!)?.sessionId).toBe("sess-sessionend-fixture-1");
  });

  it("pretooluse-activity.mjs writes the activity beacon end-to-end", () => {
    const scriptPath = path.join(HOOKS_DIR, "pretooluse-activity.mjs");
    if (!existsSync(scriptPath)) {
      console.warn("[hooks.fixtures.test] Skipping: run `npm run build` first to produce plugin/hooks/pretooluse-activity.mjs");
      return;
    }

    runBuiltHook("pretooluse-activity.mjs", "pretooluse-activity-read.json", projectDir, homeDir);
    const beacon = readActivityBeacon({ home: homeDir });
    expect(beacon?.tool).toBe("Read");
    expect(typeof beacon?.timestamp).toBe("number");
  });
});
