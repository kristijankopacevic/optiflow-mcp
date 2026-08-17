import { describe, expect, it } from "vitest";
import { encode } from "@toon-format/toon";
import { countTokens } from "../core/tokens.js";
import { evaluateGuard } from "./guard.js";

describe("evaluateGuard", () => {
  it("approves a genuinely smaller TOON output (real numbers via encode + countTokens, not hardcoded percentages)", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      active: i % 2 === 0,
      score: i * 1.5,
    }));
    const original = JSON.stringify(items);
    const candidate = encode(items);

    // Compute the real measured savings ourselves, from the same
    // countTokens function the guard uses, so this assertion is tied to
    // actual measurement rather than an assumed number.
    const tokensBefore = countTokens(original);
    const tokensAfter = countTokens(candidate);
    const realSavingsPercent = ((tokensBefore - tokensAfter) / tokensBefore) * 100;
    expect(realSavingsPercent).toBeGreaterThan(0); // sanity: TOON really is smaller here

    const result = evaluateGuard(original, candidate, items.length, { minSavingsPercent: 30, minRows: 5 });
    expect(result.tokensBefore).toBe(tokensBefore);
    expect(result.tokensAfter).toBe(tokensAfter);
    expect(result.savingsPercent).toBeCloseTo(realSavingsPercent, 5);
    expect(result.approved).toBe(realSavingsPercent >= 30);
    expect(result.approved).toBe(true);
  });

  it("rejects when TOON is measured as larger than the original (deeply nested, non-uniform data)", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? { id: i, meta: { a: i, b: { c: i, d: ["x", "y"] } } }
        : { id: i, other: `value-${i}`, extra: { deep: { deeper: i } }, flag: true }
    );
    const original = JSON.stringify(items);
    const candidate = encode(items);

    const tokensBefore = countTokens(original);
    const tokensAfter = countTokens(candidate);
    const realSavingsPercent = ((tokensBefore - tokensAfter) / tokensBefore) * 100;
    // This fixture is deliberately constructed so TOON's per-row nested
    // indentation costs more than compact JSON for non-uniform data.
    expect(realSavingsPercent).toBeLessThan(30);

    const result = evaluateGuard(original, candidate, items.length, { minSavingsPercent: 30, minRows: 5 });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/below toon\.minSavingsPercent/);
    expect(result.savingsPercent).toBeCloseTo(realSavingsPercent, 5);
  });

  it("rejects below minRows even if the savings would otherwise be huge", () => {
    const original = JSON.stringify([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    const candidate = "tiny"; // artificially huge savings, to isolate the minRows check
    const result = evaluateGuard(original, candidate, 2, { minSavingsPercent: 30, minRows: 5 });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/toon\.minRows/);
  });

  it("rejects a marginal-savings case that doesn't clear a high threshold", () => {
    const original = "x".repeat(400);
    const candidate = "x".repeat(390); // ~2.5% smaller — real, but marginal
    const tokensBefore = countTokens(original);
    const tokensAfter = countTokens(candidate);
    const realSavingsPercent = ((tokensBefore - tokensAfter) / tokensBefore) * 100;

    const result = evaluateGuard(original, candidate, 10, { minSavingsPercent: 30, minRows: 5 });
    expect(result.savingsPercent).toBeCloseTo(realSavingsPercent, 5);
    expect(result.approved).toBe(false);
  });
});
