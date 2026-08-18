import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genericFilter, type GenericFilterOptions, type SmartCrusherFilterConfig } from "./generic.js";
import type { FilterInput } from "./types.js";
import type { ToonConfig } from "../../toon/index.js";
import { getCcr } from "../../native/ccr-store.js";
import { ccrMarkerHashFor, resetWasmModuleCacheForTests, setWasmModuleOverrideForTests } from "../../native/smart-crusher.js";

function input(stdout: string, overrides: Partial<FilterInput> = {}): FilterInput {
  return { stdout, stderr: "", args: [], exitCode: 0, ...overrides };
}

// Every test below passes `toonConfig` AND `smartCrusherConfig` explicitly
// rather than relying on `genericFilter`'s defaults (which read real
// optiflow.config.json / ~/.optiflow/config.json off disk) — this keeps
// these tests deterministic regardless of what config happens to exist on
// the machine running them.
const TOON_DISABLED: ToonConfig = { enabled: false, minSavingsPercent: 30, minRows: 5 };
const TOON_ENABLED_LOW_BAR: ToonConfig = { enabled: true, minSavingsPercent: 1, minRows: 5 };
const TOON_ENABLED_DEFAULT_BAR: ToonConfig = { enabled: true, minSavingsPercent: 30, minRows: 5 };

const SMART_CRUSHER_DISABLED: SmartCrusherFilterConfig = { enabled: false, minSavingsPercent: 20 };
const SMART_CRUSHER_ENABLED_LOW_BAR: SmartCrusherFilterConfig = { enabled: true, minSavingsPercent: 1 };

/**
 * Every pre-Phase-5c test in this file exercises TOON-vs-truncation
 * behavior specifically; SmartCrusher is deliberately disabled for them so
 * they stay pinned to the exact behavior they were written to assert,
 * unaffected by the new decision-chain step Phase 5c inserted between TOON
 * and truncation. Real-WASM-module behavior for these exact fixtures was
 * independently verified (both existing non-uniform-array fixtures
 * genuinely passthrough — `skip:unique_entities_no_signal`/`passthrough`
 * strategies) before this default was chosen, so this is defense in depth,
 * not a workaround for an actual behavior change.
 */
function withToon(config: ToonConfig): GenericFilterOptions {
  return { toonConfig: config, smartCrusherConfig: SMART_CRUSHER_DISABLED };
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

  it("never even attempts SmartCrusher on non-JSON text (real headroom-core passes it through unconditionally)", () => {
    // No smartCrusherConfig override here on purpose: if this path DID try
    // SmartCrusher, a real WASM call would still passthrough per
    // crusher.rs's JSON-parse-or-passthrough gate — but the point of this
    // test is that the log-line path never calls it at all, matching this
    // file's header-comment rationale (would only ever burn a WASM call
    // for zero possible benefit).
    const lines = Array.from({ length: 100 }, (_, i) => `log line ${i} status=ok region=us-west-2`);
    const result = genericFilter(input(lines.join("\n")));
    expect(result.formatHint).toBe("log");
    expect(result.meta?.smartCrusher).toBeUndefined();
  });
});

/**
 * A realistic uniform JSON array with real repeated categorical fields
 * (`status`/`region`/`service`) — the exact shape `src/native/smart-crusher.test.ts`
 * confirms the real WASM module actually crushes (`top_n`/`smart_sample`
 * strategies), unlike the plain `{id, name}` fixtures used elsewhere in
 * this file (confirmed empirically to `skip:unique_entities_no_signal`).
 */
function buildCrushableFixture(rows: number): Array<Record<string, unknown>> {
  const items = [];
  for (let i = 0; i < rows; i++) {
    items.push({
      id: `pod-${i}`,
      status: "Running",
      region: "us-west-2",
      service: "optiflow-api",
      restarts: 0,
      timestamp: `2026-08-18T00:00:${String(i % 60).padStart(2, "0")}Z`,
    });
  }
  return items;
}

describe("genericFilter — SmartCrusher wiring (Phase 5c)", () => {
  let ccrHome: string;
  let previousOptiflowHome: string | undefined;

  beforeEach(() => {
    ccrHome = mkdtempSync(path.join(tmpdir(), "optiflow-generic-ccr-test-"));
    previousOptiflowHome = process.env.OPTIFLOW_HOME;
    process.env.OPTIFLOW_HOME = ccrHome;
    resetWasmModuleCacheForTests();
  });

  afterEach(() => {
    if (previousOptiflowHome === undefined) {
      delete process.env.OPTIFLOW_HOME;
    } else {
      process.env.OPTIFLOW_HOME = previousOptiflowHome;
    }
    rmSync(ccrHome, { recursive: true, force: true });
    resetWasmModuleCacheForTests();
  });

  it("applies SmartCrusher (between TOON and truncation) once TOON is disabled, for a large uniform array with real repeated fields", () => {
    const items = buildCrushableFixture(60);
    const original = JSON.stringify(items);
    const result = genericFilter(input(original), {
      toonConfig: TOON_DISABLED,
      smartCrusherConfig: SMART_CRUSHER_ENABLED_LOW_BAR,
    });

    expect(result.formatHint).toBe("uniform-json-array");
    const smartCrusherMeta = result.meta?.smartCrusher as { applied: boolean; strategy?: string };
    expect(smartCrusherMeta.applied).toBe(true);
    expect(smartCrusherMeta.strategy).not.toBe("passthrough");
    // Real measured shrinkage, not a truncation marker.
    expect(result.text.length).toBeLessThan(original.length);
    expect(result.text).toContain("<<ccr:");

    // The CCR marker round-trips: the hash embedded in the compressed
    // output was actually stored, and — since this is the exact
    // top-level-array case verified in smart-crusher.test.ts to
    // byte-match headroom-core's own hash input — the retrieved content
    // is the EXACT canonical bytes the marker's hash was computed from,
    // not just a superset approximation.
    const hashMatch = result.text.match(/<<ccr:([0-9a-f]{12})/);
    expect(hashMatch).not.toBeNull();
    const hash = hashMatch![1];
    expect(hash).toBe(ccrMarkerHashFor(JSON.stringify(items)));
    const retrieved = getCcr(hash);
    expect(retrieved).toBe(JSON.stringify(items));
  });

  it("falls back to Phase-3 truncation when SmartCrusher is disabled, even for an otherwise-crushable fixture", () => {
    const items = buildCrushableFixture(60);
    const result = genericFilter(input(JSON.stringify(items)), {
      toonConfig: TOON_DISABLED,
      smartCrusherConfig: SMART_CRUSHER_DISABLED,
    });
    expect(result.formatHint).toBe("uniform-json-array");
    expect((result.meta?.smartCrusher as { applied: boolean }).applied).toBe(false);
    const parsedBack = JSON.parse(result.text);
    expect(parsedBack.some((v: unknown) => typeof v === "string" && v.includes("omitted"))).toBe(true);
  });

  it("falls back to Phase-3 truncation when SmartCrusher is enabled but the measured savings don't clear the configured bar", () => {
    const items = buildCrushableFixture(60);
    const result = genericFilter(input(JSON.stringify(items)), {
      toonConfig: TOON_DISABLED,
      smartCrusherConfig: { enabled: true, minSavingsPercent: 99.99 },
    });
    expect(result.formatHint).toBe("uniform-json-array");
    expect((result.meta?.smartCrusher as { applied: boolean }).applied).toBe(false);
    const parsedBack = JSON.parse(result.text);
    expect(parsedBack.some((v: unknown) => typeof v === "string" && v.includes("omitted"))).toBe(true);
  });

  it("fails open when the WASM module is unavailable — truncation fallback still runs, never throws", () => {
    setWasmModuleOverrideForTests(null);
    const items = buildCrushableFixture(60);
    expect(() =>
      genericFilter(input(JSON.stringify(items)), {
        toonConfig: TOON_DISABLED,
        smartCrusherConfig: SMART_CRUSHER_ENABLED_LOW_BAR,
      })
    ).not.toThrow();

    const result = genericFilter(input(JSON.stringify(items)), {
      toonConfig: TOON_DISABLED,
      smartCrusherConfig: SMART_CRUSHER_ENABLED_LOW_BAR,
    });
    expect((result.meta?.smartCrusher as { applied: boolean }).applied).toBe(false);
    const parsedBack = JSON.parse(result.text);
    expect(parsedBack.some((v: unknown) => typeof v === "string" && v.includes("omitted"))).toBe(true);
  });

  it("applies SmartCrusher on the generic (non-uniform-array) JSON path for a document with a large crushable nested array", () => {
    const items = buildCrushableFixture(60);
    const doc = { apiVersion: "v1", kind: "PodList", items };
    const original = JSON.stringify(doc);
    const result = genericFilter(input(original), {
      toonConfig: TOON_DISABLED,
      smartCrusherConfig: SMART_CRUSHER_ENABLED_LOW_BAR,
    });

    expect(result.formatHint).toBe("json");
    const smartCrusherMeta = result.meta?.smartCrusher as { applied: boolean };
    expect(smartCrusherMeta.applied).toBe(true);
    expect(result.text.length).toBeLessThan(original.length);
    // Still syntactically valid JSON — SmartCrusher's re-serialization is
    // structure-preserving, never a raw string slice.
    expect(() => JSON.parse(result.text)).not.toThrow();

    // This marker's hash is over the NESTED `items` array's own canonical
    // JSON (verified empirically against the real WASM module before
    // writing this test), NOT the top-level document — so the superset
    // fallback in `storeCcrMarkers` applies: retrieval returns the WHOLE
    // top-level original document (which necessarily contains whatever
    // was dropped), not a byte-exact excerpt.
    const hashMatch = result.text.match(/<<ccr:([0-9a-f]{12})/);
    expect(hashMatch).not.toBeNull();
    const hash = hashMatch![1];
    expect(hash).not.toBe(ccrMarkerHashFor(original)); // NOT the top-level doc's own hash
    expect(hash).toBe(ccrMarkerHashFor(JSON.stringify(items))); // IS the nested array's hash
    const retrieved = getCcr(hash);
    expect(retrieved).toBe(original); // superset fallback: the whole original document
  });

  it("leaves a non-uniform JSON value untouched when SmartCrusher also declines (no real signal to crush)", () => {
    // Same fixture as the earlier TOON-focused test in this file, but with
    // SmartCrusher explicitly enabled at a near-zero bar — pins that the
    // real WASM module's own analysis (not just this filter's guard)
    // genuinely declines here, so the "never string-slice a non-uniform
    // JSON value" guarantee holds even with SmartCrusher active.
    const value = { apiVersion: "v1", items: [{ a: 1 }, { b: 2, c: 3 }] };
    const result = genericFilter(input(JSON.stringify(value)), {
      toonConfig: TOON_ENABLED_LOW_BAR,
      smartCrusherConfig: SMART_CRUSHER_ENABLED_LOW_BAR,
    });
    expect(result.formatHint).toBe("json");
    expect(JSON.parse(result.text)).toEqual(value);
  });
});
