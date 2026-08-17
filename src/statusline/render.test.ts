import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { DEFAULT_RENDER_CONFIG, render, type StatuslineInput } from "./render.js";

const FULL_INPUT: StatuslineInput = {
  model: { id: "claude-opus-4-1", display_name: "Claude Opus 4.1" },
  cwd: "C:\\Users\\me\\project",
  workspace: { current_dir: "C:\\Users\\me\\project", project_dir: "C:\\Users\\me\\project" },
  cost: { total_cost_usd: 1.2345 },
  context_window: {
    used_percentage: 34,
    remaining_percentage: 66,
    context_window_size: 200_000,
    total_input_tokens: 68_000,
  },
  exceeds_200k_tokens: false,
  transcript_path: "C:\\Users\\me\\.claude\\projects\\slug\\abc.jsonl",
};

describe("render — full input, all fields present", () => {
  it("renders meter/model/cost segments in default order, joined by the separator", () => {
    const out = render(FULL_INPUT);
    expect(out).toBe("[███░░░░░░░] 34% │ Claude Opus 4.1 │ $1.23");
  });
});

describe("render — context_window.used_percentage: null", () => {
  it("renders --% instead of NaN%, never throws", () => {
    const input: StatuslineInput = {
      ...FULL_INPUT,
      context_window: { ...FULL_INPUT.context_window, used_percentage: null },
    };
    const out = render(input);
    expect(out).toContain("--%");
    expect(out).not.toContain("NaN");
  });
});

describe("render — missing context_window entirely", () => {
  it("renders --% and never throws when context_window is absent", () => {
    const input: StatuslineInput = { model: FULL_INPUT.model, cost: FULL_INPUT.cost };
    expect(() => render(input)).not.toThrow();
    expect(render(input)).toContain("--%");
  });
});

describe("render — exceeds_200k_tokens: true", () => {
  it("flags the warning marker even when the percentage is known", () => {
    const input: StatuslineInput = { ...FULL_INPUT, exceeds_200k_tokens: true };
    expect(render(input)).toContain("⚠");
  });

  it("flags the warning marker AND renders --% (not NaN%) when combined with a null percentage", () => {
    const input: StatuslineInput = {
      ...FULL_INPUT,
      exceeds_200k_tokens: true,
      context_window: { ...FULL_INPUT.context_window, used_percentage: null },
    };
    const out = render(input);
    expect(out).toContain("--%");
    expect(out).toContain("⚠");
    expect(out).not.toContain("NaN");
  });
});

describe("render — empty input object (missing everything)", () => {
  it("never throws and renders a sensible fallback line", () => {
    expect(() => render({})).not.toThrow();
    const out = render({});
    expect(out).toContain("--%");
    expect(out).toContain("unknown-model");
  });
});

describe("render — missing/empty ledger and activity (via RenderContext)", () => {
  it("omits the savings/activity segments entirely when their context data is null", () => {
    const out = render(FULL_INPUT, { activity: null, savings: null });
    expect(out).not.toContain("♻");
    expect(out).not.toContain("⚙");
  });
});

describe("render — all segments disabled via config", () => {
  it("returns an empty string when config.enabled is false", () => {
    expect(render(FULL_INPUT, { config: { enabled: false } })).toBe("");
  });
});

describe("render — custom segment order/subset", () => {
  it("respects a custom, partial segment order", () => {
    const out = render(FULL_INPUT, { config: { segments: ["cost", "model"] } });
    expect(out).toBe("$1.23 │ Claude Opus 4.1");
  });

  it("renders nothing for an empty segments array", () => {
    expect(render(FULL_INPUT, { config: { segments: [] } })).toBe("");
  });
});

describe("render — activity and savings segments via RenderContext", () => {
  it("includes a fresh activity beacon and a positive savings figure", () => {
    const now = 1_000_000;
    const out = render(FULL_INPUT, {
      now,
      activity: { tool: "Bash", timestamp: now - 1000 },
      savings: { tokensSaved: 2500, recordCount: 3 },
    });
    expect(out).toContain("⚙ Bash");
    expect(out).toContain("♻");
    expect(out).toContain("recent");
  });

  it("omits a stale activity beacon", () => {
    const now = 1_000_000;
    const out = render(FULL_INPUT, {
      now,
      activity: { tool: "Bash", timestamp: now - DEFAULT_RENDER_CONFIG.activityStaleMs - 1 },
    });
    expect(out).not.toContain("⚙");
  });
});

describe("render — perf smoke test", () => {
  it("renders well under the 100ms statusline budget (measured, not asserted as a fixed constant)", () => {
    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      render(FULL_INPUT, {
        activity: { tool: "Bash", timestamp: Date.now() },
        savings: { tokensSaved: 100, recordCount: 1 },
      });
    }
    const elapsedMs = performance.now() - start;
    const perCallMs = elapsedMs / iterations;
    // eslint-disable-next-line no-console
    console.log(
      `[statusline perf] ${iterations} in-process render() calls in ${elapsedMs.toFixed(3)}ms ` +
        `(${perCallMs.toFixed(4)}ms/call)`
    );
    // Real number is printed above; this assertion is a generous ceiling
    // (well under the 100ms/-render statusline budget), not a tight gate —
    // CI machine speed varies.
    expect(perCallMs).toBeLessThan(5);
  });
});
