import { describe, expect, it } from "vitest";
import { npmFilter } from "./npm.js";
import { loadCliOutputFixture } from "./test-fixtures.js";
import type { FilterInput } from "./types.js";

function input(stdout: string, args: string[] = ["install"]): FilterInput {
  return { stdout, stderr: "", args, exitCode: 0 };
}

describe("npmFilter", () => {
  const stdout = loadCliOutputFixture("npm-install.txt");

  it("collapses the 8 deprecation warnings to 3 examples + a count", () => {
    const result = npmFilter(input(stdout));
    expect(result.text).toContain("npm warn deprecated inflight@1.0.6");
    expect(result.text).toContain("npm warn deprecated rimraf@3.0.2");
    expect(result.text).toContain("npm warn deprecated glob@7.2.3");
    expect(result.text).toContain("and 5 more deprecation warnings (8 total)");
    expect(result.text).not.toContain("w3c-hr-time@1.0.2");
    expect(result.meta?.deprecationWarningsOmitted).toBe(5);
  });

  it("preserves the summary lines an agent actually needs", () => {
    const result = npmFilter(input(stdout));
    expect(result.text).toContain("added 842 packages, and audited 843 packages in 12s");
    expect(result.text).toContain("128 packages are looking for funding");
    expect(result.text).toContain("3 vulnerabilities (1 low, 2 moderate)");
    expect(result.text).toContain("Run `npm audit` for details.");
    expect(result.meta?.hasSummary).toBe(true);
  });

  it("shrinks total output size", () => {
    const result = npmFilter(input(stdout));
    expect(result.text.length).toBeLessThan(stdout.length);
  });

  it("returns output unchanged (modulo trimming) when there are no deprecation warnings", () => {
    const clean = "added 5 packages in 1s\n";
    const result = npmFilter(input(clean));
    expect(result.text.trim()).toBe(clean.trim());
    expect(result.meta?.deprecationWarningsOmitted).toBe(0);
  });
});
