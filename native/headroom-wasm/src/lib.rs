//! Phase 1 proved the Rust → wasm32-unknown-unknown → Node (`wasm-pack
//! build --target nodejs`) toolchain round-trips end to end, with
//! `headroom-core` linked in (feature-stripped: `default-features =
//! false`, no optional features) as a real dependency of this crate.
//!
//! Phase 2 (this file) wires the real `SmartCrusher` compression
//! algorithm through that same toolchain — see [`smart_crush`] below.
//!
//! # The `Instant::now()` hazard, and how this module avoids it
//!
//! `SmartCrusher::crush()` (`crusher.rs:385`) calls
//! `std::time::Instant::now()` unconditionally, and its own default
//! `TracingObserver` (installed by `with_default_oss_setup()`) means
//! `start.elapsed()` also runs. Plain `wasm32-unknown-unknown` has no
//! wall-clock syscall, so `Instant::now()` panics at runtime there
//! ("time not implemented on this platform") — this would surface in
//! Node as an opaque `RuntimeError: unreachable executed`.
//!
//! `SmartCrusher::without_compaction()` additionally calls
//! `.with_default_ccr_store()`, which installs `InMemoryCcrStore`
//! (`ccr/backends/in_memory.rs`) — that backend's `put`/`get` also call
//! `Instant::now()` internally, so even avoiding `crush()` in favor of
//! a timing-free method is not enough if a CCR store is attached and a
//! row-drop actually happens (`crush_array_with_source` calls
//! `store.put(...)` on the lossy path).
//!
//! Both hazards are avoided here WITHOUT modifying `headroom-core`
//! (out of this phase's ownership) by:
//! - Calling the lower-level `SmartCrusher::smart_crush_content()`
//!   (`crusher.rs:426`) instead of `crush()`. It has no `Instant` call
//!   anywhere on its path and returns the same
//!   `(compressed, was_modified, info)` tuple `crush()` derives its
//!   `CrushResult` from — the only thing skipped is the `CrushEvent`
//!   fired to observers, which is a `tracing::debug`-level event with
//!   no subscriber installed here anyway.
//! - Building the crusher via `SmartCrusherBuilder::new(cfg)
//!   .with_default_oss_setup().build()` — i.e. `without_compaction()`
//!   minus `.with_default_ccr_store()`. With `ccr_store: None`, the
//!   `<<ccr:HASH N_rows_offloaded>>` marker and hash are still computed
//!   (that arithmetic has nothing to do with the store), but the
//!   `store.put()` call — the only call site that would reach
//!   `InMemoryCcrStore`'s `Instant::now()` — never executes. This is
//!   also the architecturally correct shape per the optiflow-mcp v2
//!   plan's locked decision: "the WASM module only computes the
//!   hash/marker, never touches disk" — CCR storage lives Node-side
//!   (`src/native/ccr-store.ts`), not in this crate's in-memory store.
//!
//! This IS a deliberate deviation from constructing via
//! `SmartCrusher::without_compaction()` directly (which the plan's task
//! description suggested as the simplest starting point) — flagged
//! here because `without_compaction()` cannot be used as-is without
//! hitting the CCR-store `Instant` hazard the moment a row actually
//! gets dropped.
//!
//! `rayon`'s thread-pool runtime behavior remains N/A: the `parallel`
//! feature stays off in this crate's `Cargo.toml` (see the dependency
//! comment there), so the orchestrator's serial fallback is what's
//! linked in, not rayon's thread pool.

use headroom_core::transforms::smart_crusher::{SmartCrusher, SmartCrusherBuilder, SmartCrusherConfig};
use wasm_bindgen::prelude::*;

/// Minimal exported stub retained from Phase 1. Confirms wasm-bindgen
/// glue + the linked `headroom-core` dependency both work end to end
/// from Node; harmless to keep alongside the real `smart_crush` export.
#[wasm_bindgen]
pub fn ping() -> String {
    format!("headroom-wasm ok ({})", headroom_core::hello())
}

/// Real SmartCrusher compression, exported for Node.
///
/// `content` is the raw text/JSON to compress; `query` is optional
/// relevance-scoring context (`""` is a valid default when there's no
/// specific query); `bias` steers `compute_optimal_k`'s adaptive sizing
/// (`0.0` is the real production default — see `transforms/live_zone.rs`'s
/// `DEFAULT_BIAS` constant, used at its own real `SmartCrusher::crush`
/// call sites; note `crusher.rs`'s own unit tests instead pass `1.0`, but
/// that is test-suite convention, not evidence of a production default —
/// this wrapper follows the production call site).
///
/// Returns a JSON string (not a wasm-bindgen struct-with-getters) because
/// `CrushResult` (`smart_crusher/types.rs`) has no `#[derive(Serialize)]`
/// today — round-tripping through a hand-built `serde_json::Value` here
/// is the least wasm-bindgen ceremony for a first correct version. The
/// JSON shape mirrors `CrushResult` exactly:
/// `{"compressed": string, "original": string, "wasModified": bool,
/// "strategy": string}`. The TS side (`src/native/smart-crusher.ts`)
/// `JSON.parse`s this.
///
/// A fresh `SmartCrusher` is constructed on every call (simplicity over
/// per-call construction overhead — an optimization for a later phase
/// if profiling ever shows it matters).
#[wasm_bindgen]
pub fn smart_crush(content: &str, query: &str, bias: f64) -> String {
    let crusher: SmartCrusher = SmartCrusherBuilder::new(SmartCrusherConfig::default())
        .with_default_oss_setup()
        .build();
    let (compressed, was_modified, info) = crusher.smart_crush_content(content, query, bias);
    let strategy = if info.is_empty() {
        "passthrough".to_string()
    } else {
        info
    };
    let out = serde_json::json!({
        "compressed": compressed,
        "original": content,
        "wasModified": was_modified,
        "strategy": strategy,
    });
    out.to_string()
}
