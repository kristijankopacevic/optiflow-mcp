import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCheckpointDir } from "./checkpoint.js";
import { findLatestCheckpoint, loadCheckpoint } from "./restore.js";
import { runPreCompactHook, type PreCompactHookInput } from "./precompact-hook.js";

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-precompact-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-precompact-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

function input(overrides: Partial<PreCompactHookInput> = {}): PreCompactHookInput {
  return { session_id: "sess-precompact-1", cwd: projectDir, transcript_path: "/tmp/t.jsonl", trigger: "auto", ...overrides };
}

async function reader(value: PreCompactHookInput | null): Promise<PreCompactHookInput | null> {
  return value;
}

describe("runPreCompactHook — handoff.enabled default (true)", () => {
  it("writes a checkpoint with empty decisions/nextSteps/openFiles (hook payload can't supply free text)", async () => {
    const output = await runPreCompactHook(() => reader(input()), { cwd: projectDir, home: homeDir });
    expect(output.systemMessage).toContain("checkpoint saved");

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    const filePath = findLatestCheckpoint(dir);
    expect(filePath).not.toBeNull();
    const checkpoint = loadCheckpoint(filePath!);
    expect(checkpoint?.sessionId).toBe("sess-precompact-1");
    expect(checkpoint?.cwd).toBe(projectDir);
    expect(checkpoint?.decisions).toEqual([]);
    expect(checkpoint?.nextSteps).toEqual([]);
    expect(checkpoint?.openFiles).toEqual([]);
  });

  it("falls back to 'unknown-session'/process.cwd() when session_id/cwd are absent from the payload", async () => {
    const output = await runPreCompactHook(() => reader({ trigger: "manual" }), { cwd: projectDir, home: homeDir });
    expect(output.systemMessage).toContain("checkpoint saved");
  });
});

describe("runPreCompactHook — handoff.enabled: false", () => {
  it("writes nothing and returns a bare {} when handoff is disabled", async () => {
    writeFileSync(path.join(projectDir, "optiflow.config.json"), JSON.stringify({ handoff: { enabled: false } }), "utf8");
    const output = await runPreCompactHook(() => reader(input()), { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    expect(existsSync(dir)).toBe(false);
  });
});

describe("runPreCompactHook — fail-open", () => {
  it("returns a bare {} (never throws) when stdin is null/unparseable", async () => {
    const output = await runPreCompactHook(() => reader(null), { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});
  });
});
