import { describe, expect, it } from "vitest";
import { dockerFilter } from "./docker.js";
import { loadCliOutputFixture } from "./test-fixtures.js";
import type { FilterInput } from "./types.js";

function input(stdout: string, args: string[] = ["ps"]): FilterInput {
  return { stdout, stderr: "", args, exitCode: 0 };
}

describe("dockerFilter", () => {
  const stdout = loadCliOutputFixture("docker-ps.txt");

  it("keeps identifying columns (NAMES, IMAGE, STATUS) and drops long/low-value columns", () => {
    const result = dockerFilter(input(stdout));
    expect(result.formatHint).toBe("table");
    expect(result.text).toContain("NAMES");
    expect(result.text).toContain("optiflow-postgres");
    expect(result.text).toContain("optiflow-api");
    // COMMAND/CREATED/PORTS are dropped per the plan's "trimmed to relevant columns".
    expect(result.text).not.toContain("docker-entrypoint");
    expect(result.text).not.toContain("3 hours ago");
    expect(result.text).not.toContain("5432/tcp");
  });

  it("does not truncate rows when under the row cap", () => {
    const result = dockerFilter(input(stdout));
    expect(result.text).not.toContain("more (");
    expect(result.meta?.totalRows).toBe(7);
  });

  it("truncates rows when there are many containers", () => {
    const header =
      "CONTAINER ID   IMAGE          COMMAND        CREATED       STATUS         PORTS          NAMES";
    const rows = Array.from(
      { length: 25 },
      (_, i) =>
        `${"a".repeat(12)}   img:${i}        \"cmd\"          1h ago        Up 1 hour      80/tcp         container-${i}`
    );
    const result = dockerFilter(input([header, ...rows].join("\n")));
    expect(result.formatHint).toBe("table");
    expect(result.meta?.totalRows).toBe(25);
    expect(result.meta?.shownRows).toBe(10);
    expect(result.text).toContain("and 15 more (25 total)");
  });

  it("falls back to the generic filter when the output isn't a recognizable table", () => {
    const result = dockerFilter(input("Error: No such container: unknown\n"));
    expect(result.formatHint).not.toBe("table");
  });
});
