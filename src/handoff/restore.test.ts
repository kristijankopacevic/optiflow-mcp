import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkpointId, writeCheckpoint, type Checkpoint } from "./checkpoint.js";
import {
  findCheckpointById,
  findLatestCheckpoint,
  loadCheckpoint,
  renderCappedRestoreOutput,
  renderRestoreMarkdown,
  resolveCheckpoint,
} from "./restore.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "optiflow-restore-checkpoints-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fullCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    sessionId: "sess-1",
    timestamp: 1000,
    cwd: "/tmp/project",
    gitBranch: "main",
    gitHead: "abc123",
    model: "claude-opus",
    openFiles: ["src/a.ts"],
    decisions: ["chose X over Y"],
    nextSteps: ["run the tests"],
    tokenOptimizerStateRef: { file: "/home/.token-optimizer/sessions.json.gz", sessionId: "sess-1", exists: true },
    ...overrides,
  };
}

function write(checkpoint: Checkpoint): string {
  return writeCheckpoint(checkpoint, { checkpointDirOverride: dir }).filePath;
}

describe("loadCheckpoint", () => {
  it("round-trips a well-formed checkpoint written by writeCheckpoint", () => {
    const checkpoint = fullCheckpoint();
    const filePath = write(checkpoint);
    expect(loadCheckpoint(filePath)).toEqual(checkpoint);
  });

  it("returns null for a missing file", () => {
    expect(loadCheckpoint(path.join(dir, "nope.json"))).toBeNull();
  });

  it("returns null for malformed JSON or a shape missing required fields", () => {
    const badPath = path.join(dir, "bad.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(badPath, "not json{{{", "utf8");
    expect(loadCheckpoint(badPath)).toBeNull();

    const missingPath = path.join(dir, "missing.json");
    writeFileSync(missingPath, JSON.stringify({ sessionId: "x" }), "utf8");
    expect(loadCheckpoint(missingPath)).toBeNull();
  });
});

describe("findLatestCheckpoint / findCheckpointById — real timestamp ordering, not filename order", () => {
  beforeEach(() => {
    // Deliberately out of filename-lexical order: "zzz" (oldest) vs "aaa" (newest).
    write(fullCheckpoint({ sessionId: "zzz", timestamp: 1000 }));
    write(fullCheckpoint({ sessionId: "mmm", timestamp: 3000 }));
    write(fullCheckpoint({ sessionId: "aaa", timestamp: 2000 }));
  });

  it("findLatestCheckpoint picks the highest in-file timestamp, not the lexically-last filename", () => {
    const latest = findLatestCheckpoint(dir);
    expect(latest).not.toBeNull();
    const checkpoint = loadCheckpoint(latest!);
    expect(checkpoint?.sessionId).toBe("mmm");
    expect(checkpoint?.timestamp).toBe(3000);
  });

  it("findCheckpointById matches an exact full id", () => {
    const id = checkpointId({ sessionId: "aaa", timestamp: 2000 });
    const found = findCheckpointById(dir, id);
    expect(found).not.toBeNull();
    expect(loadCheckpoint(found!)?.sessionId).toBe("aaa");
  });

  it("findCheckpointById matches a bare sessionId prefix, picking the newest match", () => {
    write(fullCheckpoint({ sessionId: "aaa", timestamp: 5000 })); // a second, newer "aaa" checkpoint
    const found = findCheckpointById(dir, "aaa");
    expect(loadCheckpoint(found!)?.timestamp).toBe(5000);
  });

  it("returns null when nothing matches", () => {
    expect(findCheckpointById(dir, "does-not-exist")).toBeNull();
  });

  it("findLatestCheckpoint returns null for an empty/nonexistent directory", () => {
    expect(findLatestCheckpoint(path.join(dir, "nope"))).toBeNull();
  });
});

describe("resolveCheckpoint", () => {
  it("resolves the latest when id is omitted, and null when the directory is empty", () => {
    expect(resolveCheckpoint(dir)).toBeNull();
    write(fullCheckpoint({ sessionId: "s1", timestamp: 100 }));
    expect(resolveCheckpoint(dir)?.sessionId).toBe("s1");
  });
});

describe("renderRestoreMarkdown — round trip and content", () => {
  it("renders 'no checkpoints' markdown for null", () => {
    const markdown = renderRestoreMarkdown(null);
    expect(markdown).toContain("No checkpoints found yet");
    expect(markdown).toContain("/optiflow:checkpoint");
  });

  it("round-trips a real checkpoint's fields into the rendered markdown", () => {
    const checkpoint = fullCheckpoint();
    const markdown = renderRestoreMarkdown(checkpoint);
    expect(markdown).toContain(checkpointId(checkpoint));
    expect(markdown).toContain(checkpoint.sessionId);
    expect(markdown).toContain(checkpoint.cwd);
    expect(markdown).toContain(checkpoint.gitBranch!);
    expect(markdown).toContain(checkpoint.gitHead!);
    expect(markdown).toContain(checkpoint.model!);
    expect(markdown).toContain(checkpoint.decisions[0]);
    expect(markdown).toContain(checkpoint.nextSteps[0]);
    expect(markdown).toContain(checkpoint.openFiles[0]);
    expect(markdown).toContain(checkpoint.tokenOptimizerStateRef.file);
    expect(markdown).toContain("REFERENCE only");
  });

  it("renders honest placeholders for empty decisions/nextSteps/openFiles and no git info", () => {
    const checkpoint = fullCheckpoint({
      decisions: [],
      nextSteps: [],
      openFiles: [],
      gitBranch: null,
      gitHead: null,
      model: null,
    });
    const markdown = renderRestoreMarkdown(checkpoint);
    expect(markdown).toContain("no decisions recorded");
    expect(markdown).toContain("no next steps recorded");
    expect(markdown).toContain("no open files recorded");
    expect(markdown).toContain("not a git repo, or git unavailable");
    expect(markdown).toContain("(not recorded)");
  });

  it("is under the 10,000-char cap by default for a normal-sized checkpoint", () => {
    const markdown = renderRestoreMarkdown(fullCheckpoint());
    expect(markdown.length).toBeLessThanOrEqual(10_000);
  });

  it("HARD CASE: truncates a genuinely oversized checkpoint to the cap, with a visible marker, never crashing or silently dropping content", () => {
    const hugeArray = Array.from({ length: 2000 }, (_, i) => `decision number ${i} with some extra padding text to inflate size`);
    const checkpoint = fullCheckpoint({ decisions: hugeArray, nextSteps: hugeArray });

    // Sanity: the unbounded version really is over the cap, proving this is a real oversized case.
    const full = renderRestoreMarkdown(checkpoint, { capChars: false });
    expect(full.length).toBeGreaterThan(10_000);

    const capped = renderRestoreMarkdown(checkpoint);
    expect(capped.length).toBeLessThanOrEqual(10_000);
    expect(capped).toContain("...[truncated,");
    expect(capped).toContain("chars omitted]");
    // Still starts with real, non-garbled content, not an empty/corrupt document.
    expect(capped.startsWith("## optiflow session handoff")).toBe(true);
  });

  it("a custom capChars is respected", () => {
    const checkpoint = fullCheckpoint({ decisions: Array.from({ length: 500 }, (_, i) => `decision ${i}`) });
    const capped = renderRestoreMarkdown(checkpoint, { capChars: 500 });
    expect(capped.length).toBeLessThanOrEqual(500);
  });

  it("capChars: false returns the full, unbounded document even when it exceeds 10,000 chars", () => {
    const hugeArray = Array.from({ length: 2000 }, (_, i) => `decision number ${i} with some extra padding text`);
    const checkpoint = fullCheckpoint({ decisions: hugeArray });
    const full = renderRestoreMarkdown(checkpoint, { capChars: false });
    expect(full.length).toBeGreaterThan(10_000);
    expect(full).not.toContain("...[truncated,");
  });
});

describe("renderCappedRestoreOutput — the future SessionStart hook contract", () => {
  it("produces valid, cap-respecting JSON for a normal checkpoint", () => {
    const serialized = renderCappedRestoreOutput(fullCheckpoint());
    expect(serialized.length).toBeLessThanOrEqual(10_000);
    const parsed = JSON.parse(serialized);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe("string");
  });

  it("stays valid JSON and under the cap for an oversized checkpoint", () => {
    const hugeArray = Array.from({ length: 3000 }, (_, i) => `decision number ${i} with padding text to inflate size further`);
    const checkpoint = fullCheckpoint({ decisions: hugeArray, nextSteps: hugeArray });
    const serialized = renderCappedRestoreOutput(checkpoint);
    expect(serialized.length).toBeLessThanOrEqual(10_000);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it("honors a custom hookEventName/capChars", () => {
    const serialized = renderCappedRestoreOutput(fullCheckpoint(), { hookEventName: "SessionEnd", capChars: 300 });
    expect(serialized.length).toBeLessThanOrEqual(300);
    expect(JSON.parse(serialized).hookSpecificOutput.hookEventName).toBe("SessionEnd");
  });
});
