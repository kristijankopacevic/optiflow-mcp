// Thin TS wrapper over the real headroom-core `SmartCrusher` compression
// algorithm, compiled to WASM at `native/headroom-wasm/` (see that crate's
// `src/lib.rs` for the real Rust side and the `Instant::now()` hazard this
// wrapper's Rust export deliberately avoids).
//
// ── Loading strategy (NOT a static import — see why below) ───────────────
//
// An earlier version of this module did `import { smart_crush } from
// "../../native/headroom-wasm/pkg/headroom_wasm.js"` at the top level. That
// is unsafe once this module is consumed from a real call site (Phase 5c
// wires it into `src/chop/filters/generic.ts`, reached by BOTH
// `plugin/dist/chop/wrapper.js` and `plugin/hooks/posttooluse-mcp.mjs` per
// `esbuild.config.mjs`'s real bundle output): a static ESM import failure
// throws at module-evaluation time, before any try/catch in this file OR in
// any caller's code ever runs — the exact opposite of "fail open, never
// crash a hook."
//
// There's a second, more fundamental hazard even if the import always
// resolves: `native/headroom-wasm/pkg/headroom_wasm.js` (wasm-pack's
// generated CommonJS glue) locates its `.wasm` binary via
// `` `${__dirname}/headroom_wasm_bg.wasm` ``. If esbuild's bundler inlines
// that file's source into an entry bundle (its default behavior for a
// resolvable relative import), the inlined `__dirname` reference resolves
// to the BUNDLE's own output directory, not `native/headroom-wasm/pkg/`'s
// real location — and different entry points bundle this at DIFFERENT
// depths (`plugin/hooks/*.mjs` is 2 directories deep from the repo root;
// `plugin/dist/chop/wrapper.js` is 3), confirmed empirically by running
// `npm run build` and inspecting real output paths before writing this.
// No fixed relative path threads correctly through every entry point at
// once, and rewriting `esbuild.config.mjs` to add a bundling exception is
// out of this module's ownership.
//
// The fix that needs neither: resolve the WASM glue file's ABSOLUTE path at
// RUNTIME by walking up from wherever this code is actually executing
// (`import.meta.url`, which is always accurate to the real running file,
// bundled or not) until `native/headroom-wasm/pkg/headroom_wasm.js` is
// found on disk, then `require()` that computed (non-literal) path. Because
// the argument is a runtime-computed variable, not a string literal,
// esbuild cannot statically resolve/inline it — this is documented esbuild
// behavior for dynamic `require()` calls — so the glue file is loaded for
// real from its own true on-disk location every time, and ITS internal
// `__dirname`-relative `.wasm` lookup is correct too, because it never got
// inlined into anything else's bundle in the first place.
//
// If the module can't be found or fails to load/execute for any reason
// (missing `npm run build:wasm` output, corrupted build, platform without
// a matching artifact, etc.), `compress()` below degrades to a passthrough
// result instead of throwing — see its own doc comment.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nodeRequire = createRequire(import.meta.url);

const WASM_MODULE_REL_SEGMENTS = ["native", "headroom-wasm", "pkg", "headroom_wasm.js"] as const;
/** Generous upper bound on how many parent directories to check before giving up. */
const MAX_WALK_UP = 15;

interface WasmModuleExports {
  smart_crush: (content: string, query: string, bias: number) => string;
}

/**
 * Walks up from this module's own real on-disk directory (accurate at
 * runtime even when bundled — see the module doc comment) until
 * `native/headroom-wasm/pkg/headroom_wasm.js` is found, returning its
 * absolute path, or `null` if not found within `MAX_WALK_UP` levels (e.g.
 * the WASM crate was never built).
 */
function findWasmModulePath(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < MAX_WALK_UP; i++) {
    const candidate = path.join(dir, ...WASM_MODULE_REL_SEGMENTS);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
  return null;
}

let wasmLoadAttempted = false;
let wasmModule: WasmModuleExports | null = null;

/** Loads (and memoizes) the WASM glue module. Never throws — see module doc comment. */
function loadWasmModule(): WasmModuleExports | null {
  if (wasmLoadAttempted) return wasmModule;
  wasmLoadAttempted = true;
  try {
    const modPath = findWasmModulePath();
    if (!modPath) return null;
    wasmModule = nodeRequire(modPath) as WasmModuleExports;
  } catch {
    wasmModule = null;
  }
  return wasmModule;
}

/**
 * Test-only escape hatch: forces the next `compress()` call to re-attempt
 * loading the WASM module instead of reusing the memoized result/failure.
 * Never used by production code paths.
 */
export function resetWasmModuleCacheForTests(): void {
  wasmLoadAttempted = false;
  wasmModule = null;
}

/**
 * Test-only escape hatch: forces `loadWasmModule()` to short-circuit to a
 * given value (e.g. `null`, to simulate an unbuilt/corrupted WASM crate)
 * without touching the real filesystem. Call `resetWasmModuleCacheForTests()`
 * afterward to restore normal behavior for later tests. Never used by
 * production code paths.
 */
export function setWasmModuleOverrideForTests(mod: WasmModuleExports | null): void {
  wasmLoadAttempted = true;
  wasmModule = mod;
}

export interface SmartCrushResult {
  /** The compressed output. Equal to `original` when `wasModified` is false. */
  compressed: string;
  /** The exact input `content` passed to `compress()`, unmodified. */
  original: string;
  /** Whether `compressed` differs from `original`'s re-serialized form. */
  wasModified: boolean;
  /**
   * Debug strategy string (e.g. `"smart_sample(40->3)"`, `"passthrough"`,
   * `"skip:<reason>"`). See `headroom-core`'s `crusher.rs` for the full
   * vocabulary — not an exhaustive enum on the TS side because the Rust
   * side treats it as free-form debug info, not a stable contract.
   *
   * `"unavailable:wasm-module-not-loaded"` and `"unavailable:wasm-call-failed"`
   * are this wrapper's own (not the Rust side's) — emitted only when the
   * WASM module couldn't be loaded or threw, so callers can distinguish
   * "real passthrough decision" from "the native layer wasn't available"
   * if they care to, without this ever surfacing as a thrown error.
   */
  strategy: string;
}

function unavailableResult(content: string, strategy: string): SmartCrushResult {
  return { compressed: content, original: content, wasModified: false, strategy };
}

/**
 * Compresses `content` (raw text or JSON) using the real headroom-core
 * `SmartCrusher` algorithm, compiled to WASM.
 *
 * `query` is optional relevance-scoring context; `""` (the default) means
 * no specific query bias. `bias` steers `SmartCrusher`'s adaptive sizing;
 * `0.0` (the default here) mirrors the real production default found at
 * `native/headroom-core/src/transforms/live_zone.rs`'s `DEFAULT_BIAS`
 * constant.
 *
 * Never throws on malformed input — non-JSON or too-small content comes
 * back as a `wasModified: false` / `strategy: "passthrough"` passthrough
 * (this is `headroom-core`'s own real behavior, not a wrapper-added
 * safety net; see `native/headroom-core/src/transforms/smart_crusher/crusher.rs`'s
 * `smart_crush_content` for the exact rules).
 *
 * Never throws when the WASM module itself is unavailable either (not
 * built, failed to load, or the call into it failed) — returns an
 * `unavailable:*`-strategy passthrough instead (see `SmartCrushResult.strategy`).
 * This is what makes it safe to call unconditionally from a hook's hot
 * path (`src/chop/filters/generic.ts`).
 */
export function compress(
  content: string,
  query: string = "",
  bias: number = 0.0
): SmartCrushResult {
  const mod = loadWasmModule();
  if (!mod) {
    return unavailableResult(content, "unavailable:wasm-module-not-loaded");
  }
  try {
    const raw = mod.smart_crush(content, query, bias);
    return JSON.parse(raw) as SmartCrushResult;
  } catch {
    return unavailableResult(content, "unavailable:wasm-call-failed");
  }
}

/**
 * Every CCR marker this crate can emit through this wrapper's construction
 * (`SmartCrusherBuilder::new(cfg).with_default_oss_setup().build()`, no CCR
 * store attached — see `native/headroom-wasm/src/lib.rs`'s module doc
 * comment) carries a 12-character lowercase-hex SHA-256 prefix, in one of
 * two textual shapes depending on which code path emitted it:
 *   - Row-drop (lossy array compression): `<<ccr:HASH N_rows_offloaded>>`
 *     (`crusher.rs`'s `crush_array` — hash is over
 *     `canonical_array_json(ccr_source)`, i.e. the FULL array that had rows
 *     dropped from it, not just the dropped subset).
 *   - Opaque-blob substitution (long base64/HTML strings anywhere in the
 *     JSON tree): `<<ccr:HASH,KIND,SIZE>>` (`compaction/walker.rs`'s
 *     `emit_opaque_ccr_marker` — hash is over the blob string itself).
 * Both are matched by the shared `[0-9a-f]{12}` hash followed by either a
 * space or a comma; the trailing `>>` isn't required by the pattern since
 * we only need the hash, not to validate the whole marker shape.
 */
const CCR_MARKER_RE = /<<ccr:([0-9a-f]{12})[,\s]/g;

/**
 * Extracts every distinct CCR marker hash embedded in a `compress()`
 * result's `compressed` text (deduplicated, in first-seen order). Pure —
 * no I/O, no store lookups; callers combine this with `src/native/ccr-store.js`'s
 * `putCcr`/`getCcr` to actually persist/retrieve the referenced content.
 */
export function extractCcrHashes(compressed: string): string[] {
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const match of compressed.matchAll(CCR_MARKER_RE)) {
    const hash = match[1];
    if (!seen.has(hash)) {
      seen.add(hash);
      hashes.push(hash);
    }
  }
  return hashes;
}

/**
 * Computes the 12-char lowercase-hex SHA-256 prefix headroom-core's CCR
 * markers use (`crusher.rs`'s `hash_canonical` / `compaction/walker.rs`'s
 * `emit_opaque_ccr_marker` — both this exact shape: first 6 bytes of a
 * SHA-256 digest, hex-encoded).
 *
 * Exposed so a caller that already has the EXACT canonical JSON string
 * SmartCrusher was asked to compress (e.g. `JSON.stringify` of the same
 * parsed array/value) can check whether a marker's hash byte-matches it —
 * verified empirically (see this module's test file) to match Rust's
 * `serde_json::to_string` output for ASCII/simple JSON with object-key
 * insertion order preserved, which is exactly how both `JSON.stringify`
 * and headroom-core's `Value` (built with the `preserve_order` feature)
 * behave. This is NOT a guarantee for every input (float re-formatting
 * quirks, or a marker that refers to a NESTED sub-array/opaque-blob hashed
 * at a different point in the tree than the top-level value passed in) —
 * callers should treat a match as "confirmed exact, safe to store these
 * exact bytes," and treat a non-match as "fall back to a coarser
 * guarantee" (e.g. storing the whole top-level original), never assume
 * a match.
 */
export function ccrMarkerHashFor(canonicalContent: string): string {
  return createHash("sha256").update(canonicalContent, "utf8").digest("hex").slice(0, 12);
}
