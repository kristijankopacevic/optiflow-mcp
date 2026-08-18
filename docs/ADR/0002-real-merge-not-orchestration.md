# ADR 0002: Real merge into one codebase, not an orchestration wrapper

## Status

Accepted (v2, 2026-08-18). Supersedes [ADR 0001](0001-provenance-only-submodules.md).

## Context

v1 shipped as an orchestration wrapper: token-optimizer-mcp invoked via a
version-pinned `npx`, headroom invoked via a `headroom` binary on PATH if
present, both vendored as git submodules for provenance only. It was
published as three GitHub repos (optiflow-mcp itself, plus a fork of each
upstream so `.mcp.json`/marketplace entries could reference them).

The user rejected this directly: they wanted everything combined into one
actual plugin — one repo, no forks, no wrapper shelling out to separately
installed tools. Two rounds of evidence-gathering (real source inspection,
not assumptions) then established what was actually achievable:

### token-optimizer-mcp

Already Node/TypeScript (~114K lines, 120 tool files, MIT licensed). No
cross-language barrier — the real cost is reconciling ~8 hardcoded
`~/.token-optimizer/*` paths with optiflow's own `~/.optiflow/*` convention,
and hand-porting its machine-generated hooks pipeline (`hooks-core/*.mjs` ->
generated `plugin/hooks/*.mjs`) into ordinary, hand-written TypeScript.

### headroom

Its actual compression engine is ~78% Rust (62,590 lines), invoked from
Python via PyO3 bindings — not directly embeddable in a Node process. A
literal TypeScript port was evaluated first and found to cover only ~15-25%
of headroom's real value (CodeCompressor, Kompress's ONNX path); the core
`SmartCrusher` algorithm and the whole compression pipeline orchestrator have
no realistic TS rewrite path without losing most of what makes headroom
valuable.

The user's follow-up ask — compile the real Rust core to WebAssembly instead
of rewriting it — was checked directly against `headroom-core`'s `Cargo.toml`
and source. As shipped, this is blocked by two dependencies: `rayon`
(parallel bloat-estimation, woven into the orchestrator's two-phase design)
and `tree-sitter` (integrated into the pipeline, not feature-gated), neither
of which targets `wasm32-unknown-unknown`.

**The reframing that made this tractable**: rayon's parallelism and an
onig-based tokenizer regex are constraints *headroom's own maintainers need*
— they ship a real multi-threaded Python package with a byte-for-byte
Rust/Python parity test harness (`shared_python_rust_policy_vectors`-style
fixtures throughout the codebase). optiflow does not need Python parity; it's
not headroom's package, it's optiflow's own plugin. Concretely:

- **`rayon` removed, not preserved.** A single hook invocation compresses one
  command's output — there's no batch of independent work to parallelize.
  Dropping `rayon::join`/`.par_iter()` for a serial fallback (both already
  documented in the source as behavior-equivalent, performance-only) costs
  nothing optiflow needed.
- **`tree-sitter` excluded from the Rust build; CodeCompressor reimplemented
  natively in TypeScript** via `web-tree-sitter` (the tree-sitter project's
  own actively-maintained WASM/JS binding) instead of fighting headroom's
  Rust integration into the same WASM artifact.
- **`tokenizers`' default C regex backend (`oniguruma`) swapped for its
  `unstable_wasm` feature** (`fancy-regex` + `getrandom/wasm_js`) on the
  `wasm32-unknown-unknown` target specifically, via target-specific
  dependency tables — no Python parity to preserve, so the swap is free.
- **Kompress's ONNX inference path reimplemented directly in Node** via
  `onnxruntime-node` + `transformers.js`, bypassing headroom-core's Rust `ml`
  feature (which exists to call ONNX *from Rust*; calling it from Node
  directly is simpler and avoids needing that feature at all).
- **CCR (reversible-compression) storage moved to the Node/TS side**
  (`src/native/ccr-store.ts`) instead of getting headroom's Rust storage
  backends (SQLite/Redis) into WASM — the WASM module only computes the
  compression transform and its hash marker, never touches disk.

## Decision

Fork both upstreams' relevant source directly into optiflow-mcp's own tree
and actively modify it, rather than vendor it unmodified:

- `vendor/token-optimizer-mcp`'s real tool/hook source is copied into
  `src/optimizer/` and reconciled with optiflow's own path/config/hook
  conventions.
- `vendor/headroom/crates/headroom-core` is copied into
  `native/headroom-core/`, feature-stripped (new `parallel`/`code-compress`/
  `sqlite-backend`/`remote-tokenizer` Cargo features, all on by default so a
  normal native build is unchanged; the WASM build opts out of the ones that
  don't apply), and compiled via a new `native/headroom-wasm/`
  `wasm-bindgen` crate to a `.wasm` module loaded directly by the Node
  plugin.
- `vendor/token-optimizer-mcp` and `vendor/headroom` submodules are kept
  (provenance, license text, a record of what was ported from where) but are
  not on optiflow's runtime or build import path — nothing under `src/` or
  `native/` imports from `vendor/`.
- The two GitHub forks created for v1 (`token-optimizer-mcp`,
  `headroom`) are deleted once the merge is verified working — the repo count
  goes back to exactly one.

## Verification performed before committing to this path

- Rust toolchain (rustup, `wasm32-unknown-unknown` target, `wasm-pack`) newly
  installed and confirmed working (`cargo check`/`wasm-pack build --target
  nodejs` both succeed from a clean install on this machine).
- `native/headroom-core`'s full test suite (925 tests, including the one
  fixture-based parity test still meaningful in this fork) passes with
  default features on the native target, and `cargo check` passes on
  `wasm32-unknown-unknown` with the WASM-appropriate feature set.
- A minimal WASM stub round-tripped through a real Node `require()` call
  before any real compression logic was wired in, proving the toolchain
  end-to-end ahead of the larger porting effort.
- The real `SmartCrusher::crush()` call was then wired through the WASM
  module (not a stub) — see the `native/headroom-wasm` commit history.

## Consequences

- Build-time dependency on a Rust toolchain + `wasm-pack`, new for this
  project (CI needs a Rust setup step; a contributor building from source
  needs it installed). No such dependency at runtime.
- Real engineering cost was paid, not avoided: ~12,000 lines of
  token-optimizer's enforcement-hook logic hand-ported to TypeScript, plus
  headroom-core's feature-stripping and the WASM binding crate. This is
  slower than the orchestration wrapper v1 shipped, but produces the single
  merged plugin the user actually asked for.
- headroom's CodeCompressor and Kompress are now optiflow's own
  reimplementations, not headroom's Rust code — behavior should be
  equivalent but is not byte-for-byte guaranteed identical to headroom's
  Python/Rust output (headroom's own parity guarantee was between ITS Python
  and Rust; optiflow's TS ports were never claimed to match that third data
  point exactly, only to provide the same category of compression).
