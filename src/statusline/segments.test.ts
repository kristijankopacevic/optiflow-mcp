import { describe, expect, it } from "vitest";
import { activitySegment, costSegment, meterSegment, modelSegment, savingsSegment } from "./segments.js";

describe("meterSegment", () => {
  it("renders a proportional bar for a normal percentage", () => {
    expect(meterSegment(34, false, 10)).toBe("[███░░░░░░░] 34%");
  });

  it("renders --% (not NaN%) for null", () => {
    expect(meterSegment(null, false, 10)).toBe("[░░░░░░░░░░] --%");
  });

  it("renders --% for undefined", () => {
    expect(meterSegment(undefined, false, 10)).toBe("[░░░░░░░░░░] --%");
  });

  it("clamps a negative percentage to 0 instead of throwing", () => {
    expect(() => meterSegment(-50, false, 10)).not.toThrow();
    expect(meterSegment(-50, false, 10)).toBe("[░░░░░░░░░░] 0%");
  });

  it("clamps an over-100 percentage to 100 instead of throwing", () => {
    expect(() => meterSegment(150, false, 10)).not.toThrow();
    expect(meterSegment(150, false, 10)).toBe("[██████████] 100%");
  });

  it("appends a warning marker when exceedsLimit is true, alongside a known percentage", () => {
    expect(meterSegment(92, true, 10)).toBe("[█████████░] 92% ⚠");
  });

  it("appends a warning marker alongside --% when both null percentage and exceedsLimit are true", () => {
    const out = meterSegment(null, true, 10);
    expect(out).toContain("--%");
    expect(out).toContain("⚠");
    expect(out).not.toContain("NaN");
  });

  it("respects a custom width", () => {
    expect(meterSegment(50, false, 4)).toBe("[██░░] 50%");
  });

  it("falls back to width 10 for an invalid width", () => {
    expect(meterSegment(50, false, 0)).toBe("[█████░░░░░] 50%");
    expect(meterSegment(50, false, -5)).toBe("[█████░░░░░] 50%");
  });
});

describe("modelSegment", () => {
  it("prefers display_name over id", () => {
    expect(modelSegment({ id: "claude-x", display_name: "Claude X" })).toBe("Claude X");
  });

  it("falls back to id when display_name is missing", () => {
    expect(modelSegment({ id: "claude-x" })).toBe("claude-x");
  });

  it("falls back to a placeholder when both are missing", () => {
    expect(modelSegment({})).toBe("unknown-model");
  });

  it("falls back to a placeholder for null/undefined model", () => {
    expect(modelSegment(null)).toBe("unknown-model");
    expect(modelSegment(undefined)).toBe("unknown-model");
  });
});

describe("costSegment", () => {
  it("formats a positive cost as currency", () => {
    expect(costSegment(1.2345)).toBe("$1.23");
  });

  it("formats zero as $0.00, distinct from missing", () => {
    expect(costSegment(0)).toBe("$0.00");
  });

  it("renders nothing for null", () => {
    expect(costSegment(null)).toBe("");
  });

  it("renders nothing for undefined", () => {
    expect(costSegment(undefined)).toBe("");
  });

  it("renders nothing for a non-finite value", () => {
    expect(costSegment(NaN)).toBe("");
    expect(costSegment(Infinity)).toBe("");
  });
});

describe("activitySegment", () => {
  const now = 1_000_000;

  it("renders the tool name for a fresh beacon", () => {
    expect(activitySegment({ tool: "Bash", timestamp: now - 100 }, now, 5000)).toBe("⚙ Bash");
  });

  it("renders nothing for a stale beacon", () => {
    expect(activitySegment({ tool: "Bash", timestamp: now - 6000 }, now, 5000)).toBe("");
  });

  it("renders nothing for null/undefined", () => {
    expect(activitySegment(null, now, 5000)).toBe("");
    expect(activitySegment(undefined, now, 5000)).toBe("");
  });

  it("renders nothing for an empty activity file (no tool/timestamp)", () => {
    expect(activitySegment({}, now, 5000)).toBe("");
  });

  it("treats a future timestamp (clock skew) as fresh, not stale", () => {
    expect(activitySegment({ tool: "Bash", timestamp: now + 500 }, now, 5000)).toBe("⚙ Bash");
  });
});

describe("savingsSegment", () => {
  it("renders a formatted savings figure", () => {
    expect(savingsSegment({ tokensSaved: 2500, recordCount: 3 })).toBe("♻ ~2.5k tok saved (recent)");
  });

  it("renders small figures without the k suffix", () => {
    expect(savingsSegment({ tokensSaved: 42, recordCount: 1 })).toBe("♻ ~42 tok saved (recent)");
  });

  it("renders nothing for a missing/empty ledger (null)", () => {
    expect(savingsSegment(null)).toBe("");
  });

  it("renders nothing for zero tokens saved", () => {
    expect(savingsSegment({ tokensSaved: 0, recordCount: 0 })).toBe("");
  });

  it("renders nothing for a negative figure (defensive, should never happen upstream)", () => {
    expect(savingsSegment({ tokensSaved: -10, recordCount: 1 })).toBe("");
  });
});
