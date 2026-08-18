import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverAllProjectFiles,
  discoverBySessionId,
  discoverCurrentProjectFiles,
  getClaudeProjectsDir,
  slugifyPath,
} from "./discover.js";

let projectsDir: string;

beforeEach(() => {
  projectsDir = mkdtempSync(path.join(tmpdir(), "optiflow-transcript-discover-test-"));
});

afterEach(() => {
  rmSync(projectsDir, { recursive: true, force: true });
});

describe("slugifyPath", () => {
  it("matches the confirmed real convention: 'C:\\Users\\Kristijan' -> 'C--Users-Kristijan'", () => {
    expect(slugifyPath("C:\\Users\\Kristijan")).toBe("C--Users-Kristijan");
  });

  it("collapses forward slashes and colons the same way (POSIX-style path)", () => {
    expect(slugifyPath("/home/kristijan/project")).toBe("-home-kristijan-project");
  });
});

describe("getClaudeProjectsDir", () => {
  it("honors the projectsDir override rather than touching the real home directory", () => {
    expect(getClaudeProjectsDir({ projectsDir })).toBe(path.resolve(projectsDir));
  });
});

describe("discoverCurrentProjectFiles", () => {
  it("finds .jsonl files directly under the slug directory for the given cwd", () => {
    // discoverCurrentProjectFiles slugifies path.resolve(cwd), not cwd
    // itself (see discover.ts) — on POSIX, path.resolve() on a Windows-style
    // literal like "C:\Users\..." does NOT leave it unchanged (backslashes
    // aren't separators there), so the expected slug must go through the
    // identical path.resolve() step the real function uses, or this test
    // only passes by coincidence on Windows and fails in Linux CI (as it did
    // the first time this was published: expected 2 files, got 0, because
    // the test's own slug and the function's internal slug diverged).
    const cwd = "C:\\Users\\Kristijan\\Documents\\GitHub\\optiflow-mcp";
    const slug = slugifyPath(path.resolve(cwd));
    const slugDir = path.join(projectsDir, slug);
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(path.join(slugDir, "session-a.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(slugDir, "session-b.jsonl"), "{}\n", "utf8");
    // A per-session subdirectory alongside real transcript files, confirmed
    // to hold unrelated artifacts (e.g. tool-results) — must NOT be treated
    // as a transcript source.
    mkdirSync(path.join(slugDir, "session-a", "tool-results"), { recursive: true });
    writeFileSync(path.join(slugDir, "session-a", "tool-results", "not-a-transcript.jsonl"), "{}\n", "utf8");

    const files = discoverCurrentProjectFiles(cwd, { projectsDir });

    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
    expect(files.some((f) => f.includes("tool-results"))).toBe(false);
  });

  it("returns [] gracefully when the slug directory doesn't exist (fresh machine / never launched from this cwd)", () => {
    expect(discoverCurrentProjectFiles("C:\\nowhere", { projectsDir })).toEqual([]);
  });

  it("returns [] gracefully when ~/.claude/projects itself doesn't exist at all", () => {
    const missing = path.join(projectsDir, "does-not-exist-at-all");
    expect(discoverCurrentProjectFiles("C:\\Users\\Kristijan", { projectsDir: missing })).toEqual([]);
  });
});

describe("discoverBySessionId", () => {
  it("finds a session's transcript file regardless of which slug it lives under", () => {
    const slugDir = path.join(projectsDir, "some-slug");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(path.join(slugDir, "abc-123.jsonl"), "{}\n", "utf8");

    const files = discoverBySessionId("abc-123", { projectsDir });
    expect(files).toEqual([path.join(slugDir, "abc-123.jsonl")]);
  });

  it("returns [] when no project has that session id", () => {
    expect(discoverBySessionId("nonexistent-session", { projectsDir })).toEqual([]);
  });

  it("returns [] gracefully when the projects directory doesn't exist", () => {
    const missing = path.join(projectsDir, "does-not-exist-at-all");
    expect(discoverBySessionId("abc-123", { projectsDir: missing })).toEqual([]);
  });
});

describe("discoverAllProjectFiles", () => {
  it("finds transcripts across multiple project slug directories", () => {
    mkdirSync(path.join(projectsDir, "slug-a"), { recursive: true });
    mkdirSync(path.join(projectsDir, "slug-b"), { recursive: true });
    writeFileSync(path.join(projectsDir, "slug-a", "s1.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(projectsDir, "slug-b", "s2.jsonl"), "{}\n", "utf8");

    const files = discoverAllProjectFiles({ projectsDir });
    expect(files).toHaveLength(2);
  });

  it("returns [] gracefully on a fresh machine with no ~/.claude/projects directory", () => {
    const missing = path.join(projectsDir, "does-not-exist-at-all");
    expect(discoverAllProjectFiles({ projectsDir: missing })).toEqual([]);
  });
});
