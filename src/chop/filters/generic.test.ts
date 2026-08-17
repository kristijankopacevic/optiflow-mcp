import { describe, expect, it } from "vitest";
import { genericFilter, type GenericFilterOptions } from "./generic.js";
import type { FilterInput } from "./types.js";
import type { ToonConfig } from "../../toon/index.js";

function input(stdout: string, overrides: Partial<FilterInput> = {}): FilterInput {
  return { stdout, stderr: "", args: [], exitCode: 0, ...overrides };
}

// Every test below passes `toonConfig` explicitly rather than relying on
// `genericFilter`'s default (which reads real optiflow.config.json /
// ~/.optiflow/config.json off disk) — this keeps these tests deterministic
// regardless of what config happens to exist on the machine running them.
const TOON_DISABLED: ToonConfig = { enabled: false, minSavingsPercent: 30, minRows: 5 };
const TOON_ENABLED_LOW_BAR: ToonConfig = { enabled: true, minSavingsPercent: 1, minRows: 5 };
const TOON_ENABLED_DEFAULT_BAR: ToonConfig = { enabled: true, minSavingsPercent: 30, minRows: 5 };

function withToon(config: ToonConfig): GenericFilterOptions {
  return { toonConfig: config };
}

describe("genericFilter — JSON path", () => {
  it("falls back to Phase-3 head+tail truncation when TOON is disabled (pins the pre-Phase-5 stub behavior)", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const result = genericFilter(input(JSON.stringify(items)), withToon(TOON_DISABLED));
    expect(result.formatHint).toBe("uniform-json-array");
    const parsedBack = JSON.parse(result.text);
    expect(Array.isArray(parsedBack)).toBe(true);
    expect(parsedBack.length).toBeLessThan(40);
    expect(parsedBack.some((v: unknown) => typeof v === "string" && v.includes("omitted"))).toBe(true);
    expect(result.meta?.itemCount).toBe(40);
    expect((result.meta?.toon as { applied: boolean }).applied).toBe(false);
  });

  it("uses TOON instead of truncation for a large uniform array once the savings guard approves it", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const original = JSON.stringify(items);
    const result = genericFilter(input(original), withToon(TOON_ENABLED_LOW_BAR));
    expect(result.formatHint).toBe("uniform-json-array");
    const toonMeta = result.meta?.toon as { applied: boolean; approved?: boolean };
    expect(toonMeta.applied).toBe(true);
    // TOON output is lossless over the FULL array — never a truncation
    // marker — and is genuinely not the same text as the plain JSON.
    expect(result.text).not.toContain("omitted");
    expect(result.text).not.toBe(original);
  });

  it("also tries TOON at the real default guard threshold (30%) and falls back cleanly if it doesn't clear it", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const result = genericFilter(input(JSON.stringify(items)), withToon(TOON_ENABLED_DEFAULT_BAR));
    expect(result.formatHint).toBe("uniform-json-array");
    // Whichever way the real measured savings land, the result must always
    // be one of the two well-defined shapes — never something in between.
    const toonMeta = result.meta?.toon as { applied: boolean };
    if (toonMeta.applied) {
      expect(result.text).not.toContain("omitted");
    } else {
      expect(JSON.parse(result.text).some((v: unknown) => typeof v === "string" && v.includes("omitted"))).toBe(true);
    }
  });

  it("leaves a small uniform array untouched (below both the truncation threshold and toon.minRows)", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = genericFilter(input(JSON.stringify(items)), withToon(TOON_ENABLED_LOW_BAR));
    expect(result.formatHint).toBe("uniform-json-array");
    expect(JSON.parse(result.text)).toEqual(items);
    expect((result.meta?.toon as { applied: boolean }).applied).toBe(false);
  });

  it("leaves a non-uniform top-level ARRAY (mixed key sets, deeply nested) alone — never attempts TOON on it", () => {
    // Same fixture shape used in guard.test.ts's "TOON measures larger"
    // case: a top-level array (not an object), well above toon.minRows,
    // but not a uniform-keyed object array. `genericFilter`'s own
    // `isUniformObjectArray` pre-check gates the TOON attempt entirely —
    // this never even reaches `maybeConvertToToon` — so it's the array-
    // shaped analogue of the plan's "TOON on non-uniform JSON -> returns
    // original" acceptance case, exercised at the filter-wiring layer.
    const items = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? { id: i, meta: { a: i, b: { c: i, d: ["x", "y"] } } }
        : { id: i, other: `value-${i}`, extra: { deep: { deeper: i } }, flag: true }
    );
    const original = JSON.stringify(items);
    const result = genericFilter(input(original), withToon(TOON_ENABLED_DEFAULT_BAR));
    expect(result.formatHint).toBe("json");
    expect(result.meta?.toon).toBeUndefined();
    expect(JSON.parse(result.text)).toEqual(items);
  });

  it("never string-slices a non-uniform JSON value — returns it verbatim, tagged 'json', regardless of toon config", () => {
    const value = { apiVersion: "v1", items: [{ a: 1 }, { b: 2, c: 3 }] };
    const result = genericFilter(input(JSON.stringify(value)), withToon(TOON_ENABLED_LOW_BAR));
    expect(result.formatHint).toBe("json");
    expect(() => JSON.parse(result.text)).not.toThrow();
    expect(JSON.parse(result.text)).toEqual(value);
  });

  it("does not treat plain text starting with '{' but invalid JSON as JSON", () => {
    const text = "{not actually json";
    const result = genericFilter(input(text), withToon(TOON_ENABLED_LOW_BAR));
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
