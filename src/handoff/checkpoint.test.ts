import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCheckpoint,
  checkpointId,
  createCheckpoint,
  listCheckpointFiles,
  normalizeModel,
  pruneCheckpoints,
  resolveCheckpointDir,
  resolveTokenOptimizerStateRef,
  writeCheckpoint,
  type Checkpoint,
} from "./checkpoint.js";

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-checkpoint-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-checkpoint-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

function baseCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    sessionId: "sess-1",
    timestamp: 1000,
    cwd: "/tmp/project",
    gitBranch: "main",
    gitHead: "abc123",
    model: null,
    openFiles: [],
    decisions: [],
    nextSteps: [],
    tokenOptimizerStateRef: { file: "/home/.token-optimizer/sessions.json.gz", sessionId: "sess-1", exists: false },
    ...overrides,
  };
}

describe("normalizeModel", () => {
  it("passes through a plain string", () => {
    expect(normalizeModel("claude-opus")).toBe("claude-opus");
  });

  it("trims and rejects an empty string as null", () => {
    expect(normalizeModel("   ")).toBeNull();
  });

  it("prefers display_name, then id, then slug on an object", () => {
    expect(normalizeModel({ display_name: "Opus", id: "opus-1", slug: "opus" })).toBe("Opus");
    expect(normalizeModel({ id: "opus-1", slug: "opus" })).toBe("opus-1");
    expect(normalizeModel({ slug: "opus" })).toBe("opus");
  });

  it("returns null for null/undefined/an object with no usable field", () => {
    expect(normalizeModel(null)).toBeNull();
    expect(normalizeModel(undefined)).toBeNull();
    expect(normalizeModel({})).toBeNull();
  });
});

describe("checkpointId", () => {
  it("sanitizes unsafe sessionId characters", () => {
    expect(checkpointId({ sessionId: "abc/../def", timestamp: 42 })).toBe("abcdef-42");
  });

  it("falls back to 'unknown' when sessionId sanitizes to empty", () => {
    expect(checkpointId({ sessionId: "///", timestamp: 42 })).toBe("unknown-42");
  });
});

describe("resolveTokenOptimizerStateRef", () => {
  it("reports exists: false when the file is absent", () => {
    const ref = resolveTokenOptimizerStateRef("sess-1", { tokenOptimizerHome: homeDir });
    expect(ref.exists).toBe(false);
    expect(ref.file).toBe(path.join(homeDir, ".token-optimizer", "sessions.json.gz"));
    expect(ref.sessionId).toBe("sess-1");
  });

  it("reports exists: true when the file is present", () => {
    const dir = path.join(homeDir, ".token-optimizer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "sessions.json.gz"), "fake-gzip-bytes", "utf8");
    const ref = resolveTokenOptimizerStateRef("sess-1", { tokenOptimizerHome: homeDir });
    expect(ref.exists).toBe(true);
  });
});

describe("buildCheckpoint", () => {
  it("merges input fields with injected gitInfo/tokenOptimizerHome, defaulting arrays to []", () => {
    const checkpoint = buildCheckpoint(
      { sessionId: "sess-1", cwd: "/tmp/project" },
      { now: new Date(5000), gitInfo: { branch: "main", head: "abc123" }, tokenOptimizerHome: homeDir }
    );
    expect(checkpoint).toEqual(
      baseCheckpoint({ timestamp: 5000, tokenOptimizerStateRef: { file: path.join(homeDir, ".token-optimizer", "sessions.json.gz"), sessionId: "sess-1", exists: false } })
    );
  });

  it("passes through decisions/nextSteps/openFiles when given (the manual-checkpoint path)", () => {
    const checkpoint = buildCheckpoint(
      { sessionId: "sess-1", cwd: "/tmp/project", decisions: ["chose X"], nextSteps: ["do Y"], openFiles: ["a.ts"] },
      { now: new Date(5000), gitInfo: { branch: null, head: null }, tokenOptimizerHome: homeDir }
    );
    expect(checkpoint.decisions).toEqual(["chose X"]);
    expect(checkpoint.nextSteps).toEqual(["do Y"]);
    expect(checkpoint.openFiles).toEqual(["a.ts"]);
  });

  it("never throws when cwd isn't a git repo (getGitInfo path, no injected gitInfo)", () => {
    expect(() => buildCheckpoint({ sessionId: "sess-1", cwd: projectDir })).not.toThrow();
    const checkpoint = buildCheckpoint({ sessionId: "sess-1", cwd: projectDir });
    expect(checkpoint.gitBranch).toBeNull();
    expect(checkpoint.gitHead).toBeNull();
  });
});

describe("resolveCheckpointDir", () => {
  it("defaults to <project root>/.optiflow/checkpoints", () => {
    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    expect(dir).toBe(path.join(projectDir, ".optiflow", "checkpoints"));
  });

  it("honors handoff.checkpointDir from project config", () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ handoff: { checkpointDir: "custom-dir" } }),
      "utf8"
    );
    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    expect(dir).toBe(path.join(projectDir, "custom-dir"));
  });

  it("passes an absolute checkpointDirOverride through unchanged", () => {
    const abs = path.join(homeDir, "elsewhere");
    expect(resolveCheckpointDir({ cwd: projectDir, home: homeDir, checkpointDirOverride: abs })).toBe(abs);
  });
});

describe("writeCheckpoint / listCheckpointFiles", () => {
  it("writes a well-formed JSON checkpoint file readable back byte-for-shape", () => {
    const checkpoint = baseCheckpoint();
    const { filePath, id } = writeCheckpoint(checkpoint, { cwd: projectDir, home: homeDir });
    expect(existsSync(filePath)).toBe(true);
    expect(id).toBe(checkpointId(checkpoint));
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual(checkpoint);
  });

  it("listCheckpointFiles finds it with the correct id/timestamp", () => {
    const checkpoint = baseCheckpoint({ timestamp: 7777 });
    writeCheckpoint(checkpoint, { cwd: projectDir, home: homeDir });
    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    const entries = listCheckpointFiles(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toBe(7777);
    expect(entries[0].id).toBe(checkpointId(checkpoint));
  });

  it("listCheckpointFiles silently skips malformed .json files (never throws, never counts them)", () => {
    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "garbage.json"), "not valid json{{{", "utf8");
    writeFileSync(path.join(dir, "missing-fields.json"), JSON.stringify({ foo: "bar" }), "utf8");
    expect(listCheckpointFiles(dir)).toEqual([]);
  });

  it("listCheckpointFiles returns [] for a directory that doesn't exist", () => {
    expect(listCheckpointFiles(path.join(projectDir, "nope"))).toEqual([]);
  });
});

describe("pruneCheckpoints — real timestamps, real ordering, not filename/call-count", () => {
  function writeN(dir: string, entries: Array<{ sessionId: string; timestamp: number }>): void {
    mkdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const checkpoint = baseCheckpoint({ sessionId: entry.sessionId, timestamp: entry.timestamp });
      writeFileSync(path.join(dir, `${checkpointId(checkpoint)}.json`), JSON.stringify(checkpoint), "utf8");
    }
  }

  it("keeps exactly the newest N by in-file timestamp, even when that's the REVERSE of filename lexical order", () => {
    const dir = path.join(projectDir, "cps");
    // Deliberately out of filename-sort order: "zzz-..." (oldest) would sort
    // AFTER "aaa-..." (newest) lexicographically, so a lexical-sort bug
    // would keep the wrong ones.
    writeN(dir, [
      { sessionId: "zzz", timestamp: 1000 }, // oldest
      { sessionId: "mmm", timestamp: 2000 },
      { sessionId: "aaa", timestamp: 3000 }, // newest
    ]);

    pruneCheckpoints(dir, { keep: 2 });

    const remaining = listCheckpointFiles(dir).map((e) => e.timestamp).sort((a, b) => a - b);
    expect(remaining).toEqual([2000, 3000]); // the two newest, oldest (1000) deleted
    expect(existsSync(path.join(dir, `${checkpointId(baseCheckpoint({ sessionId: "zzz", timestamp: 1000 }))}.json`))).toBe(
      false
    );
  });

  it("deletes down to exactly N when there are N+3 checkpoints", () => {
    const dir = path.join(projectDir, "cps2");
    writeN(
      dir,
      Array.from({ length: 8 }, (_, i) => ({ sessionId: `s${i}`, timestamp: (i + 1) * 100 }))
    );
    pruneCheckpoints(dir, { keep: 5 });
    expect(listCheckpointFiles(dir)).toHaveLength(5);
    const survivingTimestamps = listCheckpointFiles(dir).map((e) => e.timestamp).sort((a, b) => a - b);
    expect(survivingTimestamps).toEqual([400, 500, 600, 700, 800]); // newest 5 of 100..800
  });

  it("keep: 0 disables pruning entirely (unlimited)", () => {
    const dir = path.join(projectDir, "cps3");
    writeN(
      dir,
      Array.from({ length: 5 }, (_, i) => ({ sessionId: `s${i}`, timestamp: (i + 1) * 100 }))
    );
    pruneCheckpoints(dir, { keep: 0 });
    expect(listCheckpointFiles(dir)).toHaveLength(5);
  });

  it("is a no-op (never throws) on a directory that doesn't exist", () => {
    expect(() => pruneCheckpoints(path.join(projectDir, "nope"), { keep: 3 })).not.toThrow();
  });

  it("never deletes malformed files it can't parse (they're invisible to listCheckpointFiles)", () => {
    const dir = path.join(projectDir, "cps4");
    writeN(dir, [{ sessionId: "a", timestamp: 100 }]);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "garbage.json"), "not json", "utf8");
    pruneCheckpoints(dir, { keep: 0 }); // unlimited: shouldn't touch anything
    expect(existsSync(path.join(dir, "garbage.json"))).toBe(true);
  });
});

describe("createCheckpoint — write + prune in one call", () => {
  it("writes a checkpoint and prunes down to handoff.keep (config-resolved)", () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ handoff: { keep: 2 } }),
      "utf8"
    );

    createCheckpoint(
      { sessionId: "s1", cwd: projectDir },
      { cwd: projectDir, home: homeDir, now: new Date(100), gitInfo: { branch: null, head: null } }
    );
    createCheckpoint(
      { sessionId: "s2", cwd: projectDir },
      { cwd: projectDir, home: homeDir, now: new Date(200), gitInfo: { branch: null, head: null } }
    );
    createCheckpoint(
      { sessionId: "s3", cwd: projectDir },
      { cwd: projectDir, home: homeDir, now: new Date(300), gitInfo: { branch: null, head: null } }
    );

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    const remaining = listCheckpointFiles(dir).map((e) => e.timestamp).sort((a, b) => a - b);
    expect(remaining).toEqual([200, 300]);
  });

  it("keepOverride bypasses config resolution for tests", () => {
    createCheckpoint(
      { sessionId: "s1", cwd: projectDir },
      { cwd: projectDir, home: homeDir, now: new Date(100), gitInfo: { branch: null, head: null }, keepOverride: 5 }
    );
    createCheckpoint(
      { sessionId: "s2", cwd: projectDir },
      { cwd: projectDir, home: homeDir, now: new Date(200), gitInfo: { branch: null, head: null }, keepOverride: 1 }
    );

    const dir = resolveCheckpointDir({ cwd: projectDir, home: homeDir });
    expect(listCheckpointFiles(dir)).toHaveLength(1);
  });

  it("a pruning failure never breaks checkpoint creation itself", () => {
    // keepOverride of a non-finite value is defensively treated as "no prune" by pruneCheckpoints's own guard.
    const { write } = createCheckpoint(
      { sessionId: "s1", cwd: projectDir },
      {
        cwd: projectDir,
        home: homeDir,
        now: new Date(100),
        gitInfo: { branch: null, head: null },
        keepOverride: Number.NaN,
      }
    );
    expect(existsSync(write.filePath)).toBe(true);
  });
});
