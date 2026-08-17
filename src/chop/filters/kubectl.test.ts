import { describe, expect, it } from "vitest";
import { kubectlFilter } from "./kubectl.js";
import { loadCliOutputFixture } from "./test-fixtures.js";
import type { FilterInput } from "./types.js";

function input(stdout: string, args: string[]): FilterInput {
  return { stdout, stderr: "", args, exitCode: 0 };
}

describe("kubectlFilter — table output", () => {
  const stdout = loadCliOutputFixture("kubectl-get.txt");

  it("passes short tables through unchanged", () => {
    const result = kubectlFilter(input(stdout, ["get", "pods"]));
    expect(result.text).toBe(stdout);
  });

  it("truncates a large pod list", () => {
    const header = "NAME                  READY   STATUS    RESTARTS   AGE";
    const rows = Array.from({ length: 30 }, (_, i) => `pod-${i}               1/1     Running   0          1h`);
    const result = kubectlFilter(input([header, ...rows].join("\n"), ["get", "pods"]));
    expect(result.formatHint).toBe("table");
    expect(result.meta?.totalRows).toBe(30);
    expect(result.meta?.shownRows).toBe(15);
    expect(result.text).toContain("and 15 more (30 total)");
  });
});

describe("kubectlFilter — JSON output defers to generic.ts (never string-sliced)", () => {
  it("detects -o json and delegates without breaking JSON semantics", () => {
    const value = { apiVersion: "v1", items: [{ metadata: { name: "pod-a" } }, { metadata: { name: "pod-b" } }] };
    const result = kubectlFilter(input(JSON.stringify(value), ["get", "pods", "-o", "json"]));
    expect(() => JSON.parse(result.text)).not.toThrow();
    expect(JSON.parse(result.text)).toEqual(value);
  });

  it("detects --output=json form", () => {
    const value = { a: 1 };
    const result = kubectlFilter(input(JSON.stringify(value), ["get", "pods", "--output=json"]));
    expect(JSON.parse(result.text)).toEqual(value);
  });

  it("detects -o=json form", () => {
    const value = [1, 2, 3];
    const result = kubectlFilter(input(JSON.stringify(value), ["get", "pods", "-o=json"]));
    expect(JSON.parse(result.text)).toEqual(value);
  });
});
