//! Phase 1 stub: proves the Rust → wasm32-unknown-unknown → Node
//! (`wasm-pack build --target nodejs`) toolchain round-trips end to end,
//! with `headroom-core` linked in (feature-stripped: `default-features =
//! false`, no optional features) as a real dependency of this crate.
//!
//! Intentionally does NOT call into `headroom-core`'s real transforms
//! (e.g. `SmartCrusher::crush`) yet — that is the next phase's work, per
//! the optiflow-mcp v2 plan's build-order table.

use wasm_bindgen::prelude::*;

/// Minimal exported stub. Confirms wasm-bindgen glue + the linked
/// `headroom-core` dependency both work end to end from Node.
///
/// Touches `headroom_core::hello()` (its own identity stub, see
/// `native/headroom-core/src/lib.rs`) so this isn't just a wasm-bindgen
/// smoke test in isolation — it proves this one symbol from
/// headroom-core's feature-stripped build resolves, links, and runs
/// correctly inside the produced `.wasm`, not merely that the dependency
/// is declared in `Cargo.toml`.
///
/// What this does NOT prove: whether the rest of headroom-core (code
/// this stub never calls, and therefore code the linker never needs to
/// pull into this cdylib) actually works at wasm32 runtime. In
/// particular, two things flagged as open risks remain UNVERIFIED by
/// this phase, precisely because nothing here reaches them:
/// - `std::time::Instant::now()` in `smart_crusher/crusher.rs` (known to
///   panic on plain wasm32-unknown-unknown outside a JS host shim).
/// - `rayon`'s thread-pool behavior at runtime when the `parallel`
///   feature is enabled on headroom-core (type-checks for wasm32, per
///   `cargo check`, but that is not proof of runtime correctness without
///   SharedArrayBuffer + Web Workers wiring).
/// Both require a later phase that actually calls the real code paths.
#[wasm_bindgen]
pub fn ping() -> String {
    format!("headroom-wasm ok ({})", headroom_core::hello())
}
