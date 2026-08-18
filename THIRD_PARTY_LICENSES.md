# Third-Party Licenses

optiflow-mcp directly incorporates real, copied-in source from two upstream
projects — see `docs/ADR/0002-real-merge-not-orchestration.md` for why this
replaced the original submodule-reference/subprocess-invocation design (v1).
Both upstreams are still vendored as git submodules under `vendor/` for
provenance and license text, but that source is not on optiflow's own
runtime or build import path — the copies under `src/optimizer/` and
`native/headroom-core/` are what actually ships.

## token-optimizer-mcp

- Repository: https://github.com/ooples/token-optimizer-mcp
- License: MIT
- License text: see `vendor/token-optimizer-mcp/LICENSE` after the submodule
  is initialized (`git submodule update --init`), or view upstream directly:
  https://github.com/ooples/token-optimizer-mcp/blob/master/LICENSE
- Source copied into: `src/optimizer/` (76 real MCP tools across
  file-operations/api-database/build-systems/code-analysis/configuration/
  system-operations/output-formatting/dashboard-monitoring/intelligence/
  advanced-caching/analytics, plus the `PreToolUse`/`PreCompact` enforcement
  hooks), reconciled to this repo's own path/config conventions. MIT permits
  this directly — no additional obligation beyond retaining the license text
  above and the copyright notice.

## headroom

- Repository: https://github.com/headroomlabs-ai/headroom
- License: Apache License 2.0
- License text: see `vendor/headroom/LICENSE` after the submodule is
  initialized (`git submodule update --init`), or view upstream directly:
  https://github.com/headroomlabs-ai/headroom/blob/main/LICENSE
- Source copied into: `native/headroom-core/` (the `headroom-core` Rust
  crate — `SmartCrusher`/`TOIN` — forked, feature-stripped to remove
  `rayon`/`tree-sitter`/the default `tokenizers` C regex backend, and
  compiled to WebAssembly at `native/headroom-wasm/`). headroom's
  CodeCompressor and Kompress model were NOT copied in — those are
  optiflow's own TypeScript reimplementations (`src/native/code-compressor.ts`,
  `src/native/kompress.ts`), not derived from headroom's Rust/Python source.
- NOTICE propagation: per Apache-2.0 §4(d), headroom's own `NOTICE` file
  content is reproduced verbatim in this repo's own `NOTICE` file.

## optiflow-mcp itself

- License: MIT — see `LICENSE` in this repository's root.
