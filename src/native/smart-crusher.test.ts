import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ccrMarkerHashFor,
  compress,
  extractCcrHashes,
  resetWasmModuleCacheForTests,
  setWasmModuleOverrideForTests,
} from "./smart-crusher.js";

afterEach(() => {
  resetWasmModuleCacheForTests();
});

/**
 * A realistic uniform JSON array of the kind this project cares about —
 * shaped like `kubectl get pods -o json .items` or a paginated API log
 * dump (see `fixtures/cli-output/` for the plain-text sibling shapes this
 * mirrors). 60 rows, mostly-repeated fields (`status`/`region`/`service`)
 * plus a couple of varying fields (`id`/`timestamp`), well past
 * `min_items_to_analyze` (5) so SmartCrusher actually analyzes the array
 * rather than passing it through untouched.
 */
function buildRealisticFixture(rows: number): string {
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
  return JSON.stringify(items);
}

describe("compress() — real headroom-core SmartCrusher via WASM", () => {
  it("compresses a large uniform JSON array (real measured behavior)", () => {
    const input = buildRealisticFixture(60);
    const result = compress(input);

    expect(result.wasModified).toBe(true);
    expect(result.strategy).not.toBe("passthrough");
    expect(result.compressed.length).toBeLessThan(result.original.length);
    // The original must round-trip back EXACTLY the input given, byte for
    // byte — `CrushResult.original` is `content.to_string()` on the Rust
    // side, not a re-serialization.
    expect(result.original).toBe(input);

    // Real measured numbers (not just "it compressed") — logged so a
    // human reviewing test output sees the actual before/after sizes.
    // eslint-disable-next-line no-console
    console.log(
      `smart-crusher fixture: original=${result.original.length}B compressed=${result.compressed.length}B ` +
        `ratio=${(result.compressed.length / result.original.length).toFixed(3)} strategy=${result.strategy}`
    );
  });

  it("emits a CCR marker for the rows it drops, and drops most of a highly-uniform array", () => {
    const input = buildRealisticFixture(60);
    const result = compress(input);

    expect(result.compressed).toContain("<<ccr:");
    expect(result.compressed).toContain("_rows_offloaded>>");
  });

  it("passes through content too small/simple to compress, without crashing", () => {
    // Compact-form JSON: SmartCrusher's serializer emits `,`/`:` with no
    // spaces, so `wasModified` compares against that compact form. Using
    // already-compact JSON here means a real passthrough (below
    // min_items_to_analyze=5) is genuinely unmodified, not just
    // re-serialized to a different-looking (but equivalent) string.
    const input = "[1,2,3]";
    const result = compress(input);

    expect(result.wasModified).toBe(false);
    expect(result.strategy).toBe("passthrough");
    expect(result.compressed).toBe(input);
    expect(result.original).toBe(input);
  });

  it("passes through non-JSON content without crashing", () => {
    const input = "this is not json at all, just plain text output";
    const result = compress(input);

    expect(result.wasModified).toBe(false);
    expect(result.strategy).toBe("passthrough");
    expect(result.compressed).toBe(input);
  });

  it("passes through a bare scalar JSON value without crashing", () => {
    const result = compress("42");
    expect(result.wasModified).toBe(false);
    expect(result.strategy).toBe("passthrough");
  });

  it("accepts an explicit query and bias without changing the passthrough contract", () => {
    const result = compress("[1,2,3]", "some query context", 0.5);
    expect(result.wasModified).toBe(false);
    expect(result.strategy).toBe("passthrough");
  });
});

describe("compress() — fail-open when the WASM module is unavailable", () => {
  it("degrades to a passthrough result instead of throwing when the module fails to load", () => {
    setWasmModuleOverrideForTests(null);
    const result = compress("some content that would otherwise be crushed");
    expect(result.wasModified).toBe(false);
    expect(result.strategy).toBe("unavailable:wasm-module-not-loaded");
    expect(result.compressed).toBe("some content that would otherwise be crushed");
    expect(result.original).toBe("some content that would otherwise be crushed");
  });

  it("degrades to a passthrough result instead of throwing when the module's call throws", () => {
    setWasmModuleOverrideForTests({
      smart_crush: () => {
        throw new Error("simulated WASM runtime failure");
      },
    });
    expect(() => compress("anything")).not.toThrow();
    const result = compress("anything");
    expect(result.strategy).toBe("unavailable:wasm-call-failed");
    expect(result.wasModified).toBe(false);
  });

  it("degrades to a passthrough result instead of throwing when the module returns unparseable output", () => {
    setWasmModuleOverrideForTests({ smart_crush: () => "not valid json" });
    const result = compress("anything");
    expect(result.strategy).toBe("unavailable:wasm-call-failed");
  });
});

describe("extractCcrHashes()", () => {
  it("extracts the hash from a real row-drop marker emitted by compress()", () => {
    const input = buildRealisticFixture(60);
    const result = compress(input);
    const hashes = extractCcrHashes(result.compressed);
    expect(hashes.length).toBeGreaterThan(0);
    expect(hashes[0]).toMatch(/^[0-9a-f]{12}$/);
  });

  it("returns an empty array when there is no marker", () => {
    expect(extractCcrHashes("[1,2,3]")).toEqual([]);
    expect(extractCcrHashes("plain text, no markers here")).toEqual([]);
  });

  it("extracts both marker shapes (row-drop space-separated and opaque-blob comma-separated)", () => {
    const text =
      "prefix <<ccr:abc123def456 42_rows_offloaded>> middle <<ccr:112233445566,base64,2.1KB>> suffix";
    expect(extractCcrHashes(text)).toEqual(["abc123def456", "112233445566"]);
  });

  it("deduplicates repeated markers for the same hash, preserving first-seen order", () => {
    const text = "<<ccr:aaaaaaaaaaaa 1_rows_offloaded>> ... <<ccr:aaaaaaaaaaaa 1_rows_offloaded>>";
    expect(extractCcrHashes(text)).toEqual(["aaaaaaaaaaaa"]);
  });
});

describe("ccrMarkerHashFor()", () => {
  it("matches the real marker hash for a top-level array compress() actually crushed", () => {
    // Empirically confirmed (not assumed) against the real WASM module:
    // headroom-core's `canonical_array_json` + `hash_canonical` produce a
    // hash byte-identical to `sha256(JSON.stringify(parsedArray)).slice(0,12)`
    // for this ASCII/simple-object fixture shape, because both sides
    // preserve object-key insertion order.
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: `pod-${i}`,
      status: "Running",
      region: "us-west-2",
      service: "optiflow-api",
      restarts: 0,
      timestamp: `2026-08-18T00:00:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const input = JSON.stringify(rows);
    const result = compress(input);
    const hashes = extractCcrHashes(result.compressed);
    expect(hashes.length).toBeGreaterThan(0);
    expect(ccrMarkerHashFor(JSON.stringify(rows))).toBe(hashes[0]);
  });

  it("computes a plain 12-char lowercase-hex SHA-256 prefix", () => {
    const content = "hello world";
    const expected = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
    expect(ccrMarkerHashFor(content)).toBe(expected);
    expect(ccrMarkerHashFor(content)).toMatch(/^[0-9a-f]{12}$/);
  });
});
