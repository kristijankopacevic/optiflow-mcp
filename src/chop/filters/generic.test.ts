import { describe, expect, it } from "vitest";
import { genericFilter } from "./generic.js";
import type { FilterInput } from "./types.js";

function input(stdout: string, overrides: Partial<FilterInput> = {}): FilterInput {
  return { stdout, stderr: "", args: [], exitCode: 0, ...overrides };
}

describe("genericFilter — JSON path", () => {
  it("truncates a large uniform JSON array of objects, flagging the TOON extension-point hint", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const result = genericFilter(input(JSON.stringify(items)));
    expect(result.formatHint).toBe("uniform-json-array");
    const parsedBack = JSON.parse(result.text);
    expect(Array.isArray(parsedBack)).toBe(true);
    expect(parsedBack.length).toBeLessThan(40);
    expect(parsedBack.some((v: unknown) => typeof v === "string" && v.includes("omitted"))).toBe(true);
    expect(result.meta?.itemCount).toBe(40);
  });

  it("leaves a small uniform array untouched (below the truncation threshold)", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = genericFilter(input(JSON.stringify(items)));
    expect(result.formatHint).toBe("uniform-json-array");
    expect(JSON.parse(result.text)).toEqual(items);
  });

  it("never string-slices a non-uniform JSON value — returns it verbatim, tagged 'json'", () => {
    const value = { apiVersion: "v1", items: [{ a: 1 }, { b: 2, c: 3 }] };
    const result = genericFilter(input(JSON.stringify(value)));
    expect(result.formatHint).toBe("json");
    expect(() => JSON.parse(result.text)).not.toThrow();
    expect(JSON.parse(result.text)).toEqual(value);
  });

  it("does not treat plain text starting with '{' but invalid JSON as JSON", () => {
    const text = "{not actually json";
    const result = genericFilter(input(text));
    expect(result.formatHint).not.toBe("json");
    expect(result.formatHint).not.toBe("uniform-json-array");
  });
});

describe("genericFilter — line-oriented fallback", () => {
  it("returns short text unchanged", () => {
    const result = genericFilter(input("line one\nline two\n"));
    expect(result.formatHint).toBe("plain");
    expect(result.text).toBe("line one\nline two\n");
  });

  it("truncates long non-JSON output to head+tail with an omitted-count marker", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `log line ${i}`);
    const result = genericFilter(input(lines.join("\n")));
    expect(result.formatHint).toBe("log");
    expect(result.text).toContain("log line 0");
    expect(result.text).toContain("log line 99");
    expect(result.text).toContain("lines omitted");
    expect(result.text.split("\n").length).toBeLessThan(100);
    expect(result.meta?.omittedLines).toBe(100 - 20 - 10);
  });
});
