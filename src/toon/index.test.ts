import { describe, expect, it } from "vitest";
import { decode } from "./convert.js";
import { countTokens } from "../core/tokens.js";
import { maybeConvertToToon, type ToonConfig } from "./index.js";

const DEFAULT_TOON_CONFIG: ToonConfig = { enabled: true, minSavingsPercent: 30, minRows: 5 };

describe("maybeConvertToToon — integration", () => {
  it("achieves a real measured >=30% token reduction on a realistic 50-row uniform JSON array (plan's acceptance number)", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      active: i % 2 === 0,
      score: Math.round(i * 1.5 * 100) / 100,
    }));
    const original = JSON.stringify(items);

    const result = maybeConvertToToon(original, DEFAULT_TOON_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.format).toBe("json");
    expect(result.guard).toBeDefined();
    // Real measured numbers, not asserted assumptions — report whatever
    // this actually comes out to.
    // eslint-disable-next-line no-console
    console.log(
      `[toon integration] tokensBefore=${result.guard?.tokensBefore} tokensAfter=${result.guard?.tokensAfter} savings=${result.guard?.savingsPercent.toFixed(1)}%`
    );
    expect(result.guard!.savingsPercent).toBeGreaterThanOrEqual(30);

    // No silent information loss for the JSON path: decoding the TOON
    // output reproduces the exact original array.
    expect(decode(result.output)).toEqual(items);
  });

  it("returns the original untouched for non-uniform, deeply nested JSON that TOON doesn't shrink enough", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? { id: i, meta: { a: i, b: { c: i, d: ["x", "y"] } } }
        : { id: i, other: `value-${i}`, extra: { deep: { deeper: i } }, flag: true }
    );
    const original = JSON.stringify(items);

    const result = maybeConvertToToon(original, DEFAULT_TOON_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.output).toBe(original);
    expect(result.reason).toMatch(/toon\.minSavingsPercent/);
  });

  it("returns the original untouched when disabled, regardless of shape", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const original = JSON.stringify(items);
    const result = maybeConvertToToon(original, { ...DEFAULT_TOON_CONFIG, enabled: false });
    expect(result.ok).toBe(false);
    expect(result.output).toBe(original);
    expect(result.reason).toMatch(/enabled is false/);
  });

  it("returns the original untouched below minRows, without even attempting conversion", () => {
    const items = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    const original = JSON.stringify(items);
    const result = maybeConvertToToon(original, DEFAULT_TOON_CONFIG);
    expect(result.ok).toBe(false);
    expect(result.output).toBe(original);
    expect(result.reason).toMatch(/minRows/);
    // No guard was even run since the row-count pre-filter caught it first.
    expect(result.guard).toBeUndefined();
  });

  it("returns the original untouched for plain text/log input", () => {
    const original = Array.from({ length: 30 }, (_, i) => `2026-01-01T00:00:${String(i).padStart(2, "0")}Z INFO step ${i}`).join(
      "\n"
    );
    const result = maybeConvertToToon(original, DEFAULT_TOON_CONFIG);
    expect(result.ok).toBe(false);
    expect(result.output).toBe(original);
  });

  it("declines YAML input cleanly (detected, but conversion not implemented) rather than corrupting it", () => {
    const original = ["name: example", "replicas: 3", "tags:", "  - a", "  - b", "  - c", "  - d", "  - e"].join("\n");
    const result = maybeConvertToToon(original, DEFAULT_TOON_CONFIG);
    expect(result.ok).toBe(false);
    expect(result.output).toBe(original); // never corrupted — original returned verbatim
  });

  it("never throws, even on pathological input", () => {
    expect(() => maybeConvertToToon("", DEFAULT_TOON_CONFIG)).not.toThrow();
    expect(() => maybeConvertToToon("[".repeat(10000), DEFAULT_TOON_CONFIG)).not.toThrow();
    // A config with an out-of-range percent shouldn't crash the pipeline either.
    expect(() => maybeConvertToToon("[1,2,3]", { enabled: true, minSavingsPercent: 999, minRows: 0 })).not.toThrow();
  });

  it("countTokens is being exercised for real (sanity check the heuristic is deterministic chars/4)", () => {
    expect(countTokens("abcd")).toBe(1);
    expect(countTokens("abcde")).toBe(2);
  });
});
