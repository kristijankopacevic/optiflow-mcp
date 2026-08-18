// Thin TS wrapper over the real headroom-core `SmartCrusher` compression
// algorithm, compiled to WASM at `native/headroom-wasm/` (see that crate's
// `src/lib.rs` for the real Rust side and the `Instant::now()` hazard this
// wrapper's Rust export deliberately avoids).
//
// Pure-ish transform, matching the rest of the codebase's convention (see
// `src/toon/convert.ts`): the only I/O is loading the compiled `.wasm`
// module itself, done once at module load (not per call, not lazily
// deferred further) — `compress()` below never touches the filesystem
// beyond that one-time load.
//
// `wasm-pack build --target nodejs` emits a CommonJS module
// (`native/headroom-wasm/pkg/headroom_wasm.js`, confirmed by reading the
// real generated file — `exports.smart_crush = ...` + `require('fs')`).
// Node's ESM loader statically detects those `exports.*` assignments
// (cjs-module-lexer) and exposes them as real named exports even though
// this package (`"type": "module"`) is ESM — the same mechanism the
// Phase 1 `verify.mjs` script already relies on. No `createRequire`
// indirection needed.

import { smart_crush as wasmSmartCrush } from "../../native/headroom-wasm/pkg/headroom_wasm.js";

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
   */
  strategy: string;
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
 */
export function compress(
  content: string,
  query: string = "",
  bias: number = 0.0
): SmartCrushResult {
  const raw = wasmSmartCrush(content, query, bias);
  return JSON.parse(raw) as SmartCrushResult;
}
