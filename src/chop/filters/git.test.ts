import { describe, expect, it } from "vitest";
import { gitFilter } from "./git.js";
import { loadCliOutputFixture } from "./test-fixtures.js";
import type { FilterInput } from "./types.js";

function input(stdout: string, args: string[]): FilterInput {
  return { stdout, stderr: "", args, exitCode: 0 };
}

describe("gitFilter — git status", () => {
  const stdout = loadCliOutputFixture("git-status.txt");

  it("shrinks a large untracked-file list to counts + a few examples", () => {
    const result = gitFilter(input(stdout, ["status"]));
    expect(result.text).toContain("(31 total in this section)");
    expect(result.text).toContain("... and 26 more");
    // Keeps a few real examples, not all 31.
    expect(result.text).toContain("build-1.log");
    expect(result.text.split("\n").length).toBeLessThan(stdout.split("\n").length);
  });

  it("keeps small sections (<=5 files) fully, without a '... and N more' marker", () => {
    const result = gitFilter(input(stdout, ["status"]));
    expect(result.text).toContain("(2 total in this section)");
    expect(result.text).toContain("modified:   src/core/tokens.ts");
    expect(result.text).toContain("modified:   README.md");
  });

  it("shrinks total output size meaningfully", () => {
    const result = gitFilter(input(stdout, ["status"]));
    expect(result.text.length).toBeLessThan(stdout.length);
  });

  it("preserves the branch preamble", () => {
    const result = gitFilter(input(stdout, ["status"]));
    expect(result.text).toContain("On branch feature/big-refactor");
  });
});

describe("gitFilter — other subcommands fall back to generic truncation", () => {
  it("truncates a long git log with head+tail", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `commit ${i} - message ${i}`);
    const result = gitFilter(input(lines.join("\n"), ["log", "--oneline"]));
    expect(result.formatHint).toBe("log");
    expect(result.text).toContain("commit 0");
    expect(result.text).toContain("commit 79");
  });

  it("leaves short git diff output unchanged", () => {
    const result = gitFilter(input("diff --git a/x b/x\n+added line\n", ["diff"]));
    expect(result.formatHint).toBe("plain");
  });
});

describe("gitFilter — finds the subcommand past global flags", () => {
  const stdout = loadCliOutputFixture("git-status.txt");

  it("recognizes 'status' even behind a -C <path> global flag", () => {
    const result = gitFilter(input(stdout, ["-C", "/some/repo", "status"]));
    expect(result.text).toContain("(31 total in this section)");
  });

  it("recognizes 'status' even behind a bare boolean flag like --no-pager", () => {
    const result = gitFilter(input(stdout, ["--no-pager", "status"]));
    expect(result.text).toContain("(31 total in this section)");
  });
});
