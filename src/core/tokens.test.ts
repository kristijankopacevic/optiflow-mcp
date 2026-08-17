import { describe, expect, it } from "vitest";
import { countTokens, estimateTokens } from "./tokens.js";

describe("countTokens (heuristic fallback)", () => {
  it("approximates ~4 chars per token", () => {
    expect(countTokens("abcd")).toBe(1);
    expect(countTokens("abcdefgh")).toBe(2);
    expect(countTokens("")).toBe(0);
  });

  it("rounds up for partial tokens", () => {
    expect(countTokens("abcde")).toBe(2); // ceil(5/4) = 2
  });

  it("scales roughly linearly for longer text", () => {
    const text = "a".repeat(400);
    expect(countTokens(text)).toBe(100);
  });
});

describe("estimateTokens (byte-length heuristic)", () => {
  it("uses the same ~4 bytes per token approximation", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(4000)).toBe(1000);
  });
});
