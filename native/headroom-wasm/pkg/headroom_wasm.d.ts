/* tslint:disable */
/* eslint-disable */

/**
 * Minimal exported stub retained from Phase 1. Confirms wasm-bindgen
 * glue + the linked `headroom-core` dependency both work end to end
 * from Node; harmless to keep alongside the real `smart_crush` export.
 */
export function ping(): string;

/**
 * Real SmartCrusher compression, exported for Node.
 *
 * `content` is the raw text/JSON to compress; `query` is optional
 * relevance-scoring context (`""` is a valid default when there's no
 * specific query); `bias` steers `compute_optimal_k`'s adaptive sizing
 * (`0.0` is the real production default — see `transforms/live_zone.rs`'s
 * `DEFAULT_BIAS` constant, used at its own real `SmartCrusher::crush`
 * call sites; note `crusher.rs`'s own unit tests instead pass `1.0`, but
 * that is test-suite convention, not evidence of a production default —
 * this wrapper follows the production call site).
 *
 * Returns a JSON string (not a wasm-bindgen struct-with-getters) because
 * `CrushResult` (`smart_crusher/types.rs`) has no `#[derive(Serialize)]`
 * today — round-tripping through a hand-built `serde_json::Value` here
 * is the least wasm-bindgen ceremony for a first correct version. The
 * JSON shape mirrors `CrushResult` exactly:
 * `{"compressed": string, "original": string, "wasModified": bool,
 * "strategy": string}`. The TS side (`src/native/smart-crusher.ts`)
 * `JSON.parse`s this.
 *
 * A fresh `SmartCrusher` is constructed on every call (simplicity over
 * per-call construction overhead — an optimization for a later phase
 * if profiling ever shows it matters).
 */
export function smart_crush(content: string, query: string, bias: number): string;
