import { describe, expect, it } from "vitest";
import { testrunnerFilter } from "./testrunner.js";
import { loadCliOutputFixture } from "./test-fixtures.js";
import type { FilterInput } from "./types.js";

function input(stdout: string, args: string[] = []): FilterInput {
  return { stdout, stderr: "", args, exitCode: 1 };
}

describe("testrunnerFilter — jest-style output with failures", () => {
  const stdout = loadCliOutputFixture("jest.txt");

  it("keeps both FAIL file lines verbatim", () => {
    const result = testrunnerFilter(input(stdout, ["--coverage"]));
    expect(result.text).toContain("FAIL src/chop/filters/git.test.ts");
    expect(result.text).toContain("FAIL src/chop/filters/terraform.test.ts");
  });

  it("keeps failure detail blocks verbatim", () => {
    const result = testrunnerFilter(input(stdout));
    expect(result.text).toContain("gitFilter > summarizes a large untracked file list");
    expect(result.text).toContain('Expected substring: "and 25 more"');
    expect(result.text).toContain("terraformFilter > preserves the Plan: summary line verbatim");
  });

  it("drops individual PASS lines, replacing them with a count", () => {
    const result = testrunnerFilter(input(stdout));
    expect(result.text).not.toContain("PASS src/chop/allowlist.test.ts");
    expect(result.text).toContain("12 test file(s) passed (individual output omitted)");
  });

  it("keeps the summary line(s)", () => {
    const result = testrunnerFilter(input(stdout));
    expect(result.text).toContain("Tests:       2 failed, 187 passed, 189 total");
    expect(result.text).toContain("Test Suites: 2 failed, 12 passed, 14 total");
  });

  it("reports accurate meta counts", () => {
    const result = testrunnerFilter(input(stdout));
    expect(result.meta).toEqual(
      expect.objectContaining({ hasFailures: true, passedFiles: 12, failedFiles: 2, failureBlocks: 2 })
    );
  });

  it("shrinks total output size", () => {
    const result = testrunnerFilter(input(stdout));
    expect(result.text.length).toBeLessThan(stdout.length);
  });
});

describe("testrunnerFilter — all green", () => {
  it("collapses to counts only when everything passes", () => {
    const stdout = [
      "PASS src/a.test.ts",
      "PASS src/b.test.ts",
      "PASS src/c.test.ts",
      "",
      "Test Suites: 3 passed, 3 total",
      "Tests:       42 passed, 42 total",
      "Time:        1.2 s",
    ].join("\n");
    const result = testrunnerFilter(input(stdout));
    expect(result.meta).toEqual(expect.objectContaining({ hasFailures: false, passedFiles: 3 }));
    expect(result.text).not.toContain("PASS src/a.test.ts");
    expect(result.text).toContain("3 test file(s) passed");
    expect(result.text).toContain("Tests:       42 passed, 42 total");
  });
});

describe("testrunnerFilter — pytest-style failures", () => {
  it("keeps FAILED lines and the session summary line", () => {
    const stdout = [
      "test_a.py .....                                                        [ 40%]",
      "test_b.py F....                                                        [100%]",
      "",
      "=================================== FAILURES ===================================",
      "_________________________________ test_thing ___________________________________",
      "",
      "    def test_thing():",
      ">       assert 1 == 2",
      "E       assert 1 == 2",
      "",
      "test_b.py:12: AssertionError",
      "=========================== short test summary info ============================",
      "FAILED test_b.py::test_thing - assert 1 == 2",
      "======================== 1 failed, 9 passed in 0.42s =========================",
    ].join("\n");
    const result = testrunnerFilter(input(stdout, ["-q"]));
    expect(result.text).toContain("FAILED test_b.py::test_thing - assert 1 == 2");
    expect(result.text).toContain("1 failed, 9 passed in 0.42s");
    expect(result.meta?.hasFailures).toBe(true);
  });
});

describe("testrunnerFilter — go test failures", () => {
  it("keeps --- FAIL: lines and drops individual ok package noise", () => {
    const stdout = [
      "ok      example.com/pkg/a       0.004s",
      "ok      example.com/pkg/b       0.002s",
      "--- FAIL: TestSomething (0.00s)",
      "    thing_test.go:10: expected 1, got 2",
      "FAIL",
      "FAIL    example.com/pkg/c       0.003s",
    ].join("\n");
    const result = testrunnerFilter(input(stdout, ["test", "./..."]));
    expect(result.text).toContain("--- FAIL: TestSomething");
    expect(result.text).toContain("FAIL    example.com/pkg/c       0.003s");
    expect(result.meta?.hasFailures).toBe(true);
  });
});
