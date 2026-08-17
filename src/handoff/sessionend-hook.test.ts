import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCheckpointDir } from "./checkpoint.js";
import { findLatestCheckpoint, loadCheckpoint } from "./restore.js";
import { runSessionEndHook, type SessionEndHookInput } from "./sessionend-hook.js";

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-sessionend-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-sessionend-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

function input(overrides: Partial<SessionEndHookInput> = {}): SessionEndHookInput {
  return { session_id: "sess-end-1", cwd: projectDir, reason: "clear", ...overrides };
}

async function reader(value: SessionEndHookInput | null): Promise<SessionEndHookInput | null> {
  return value;
}

describe("runSessionEndHook — handoff.enabled default (true)", () => {
  it("writes a checkpoint and always returns a bare {} (no user-visible surface left at session end)", async () => {
    const output = await runSessionEndHook(() => reader(input()), { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    const filePath = findLatestCheckpoint(dir);
    expect(filePath).not.toBeNull();
    expect(loadCheckpoint(filePath!)?.sessionId).toBe("sess-end-1");
  });
});

describe("runSessionEndHook — handoff.enabled: false", () => {
  it("writes nothing when handoff is disabled", async () => {
    writeFileSync(path.join(projectDir, "optiflow.config.json"), JSON.stringify({ handoff: { enabled: false } }), "utf8");
    const output = await runSessionEndHook(() => reader(input()), { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    expect(existsSync(dir)).toBe(false);
  });
});

describe("runSessionEndHook — fail-open", () => {
  it("returns a bare {} (never throws) when stdin is null/unparseable", async () => {
    const output = await runSessionEndHook(() => reader(null), { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});
  });
});
