# Architecture

## What optiflow-mcp is

optiflow-mcp is a single Claude Code plugin, one MCP server, one repository —
not a wrapper around two separately-installed tools. It genuinely merges the
real source of two upstream projects into its own codebase:

1. **token-optimizer-mcp**'s 76 real `smart_*`/analytics/dashboard-monitoring
   MCP tools and its `PreToolUse`/`PreCompact` enforcement hooks are ported
   directly into `src/optimizer/` — no `npx` install, no separate process.
   Everything runs on optiflow's own in-process MCP server
   (`src/optimizer/server.ts`, launched by `plugin/.mcp.json`).
2. **headroom**'s actual Rust compression core (`SmartCrusher`, `TOIN`) is
   forked into `native/headroom-core/`, feature-stripped, and compiled to a
   real WebAssembly module (`native/headroom-wasm/`) loaded directly by the
   Node plugin — the genuine Rust algorithm, not a rewrite, with no separate
   `headroom` binary and no Python process. headroom's CodeCompressor and the
   Kompress ML model are reimplemented natively in TypeScript instead
   (`src/native/`) — see "Why a merge, not an orchestrator" below for why
   those two pieces are ports rather than compiled Rust.
3. optiflow's own five modules (chop, statusline, TOON, transcript/report,
   handoff) own ground neither upstream tool covered.

This is v2 of the architecture. v1 vendored both upstreams as git submodules
and invoked them externally (pinned `npx`, a separate `headroom` binary on
PATH) — see `docs/ADR/0001-provenance-only-submodules.md` for that reasoning
and `docs/ADR/0002-real-merge-not-orchestration.md` for why it was reversed.
Both upstream projects are still vendored as git submodules under `vendor/`
for provenance/reference (their license text, and a paper trail for what was
ported from where) — but their code is copied and actively modified, not run
at runtime; `vendor/` is not on optiflow's own require/import path.

## Why a merge, not an orchestrator

v1's stated reasoning ("a literal code-level merge... would be a multi-week
effort with high architectural risk") undersold headroom's real portability
and overstated the risk on token-optimizer's side:

- **token-optimizer-mcp is already Node/TypeScript.** There was never a
  cross-language barrier here — only ~114K lines needing path/hook
  reconciliation with optiflow's own conventions. Real effort, but not a
  cross-runtime problem.
- **headroom's actual compression engine (`SmartCrusher`) is Rust, invoked
  from Python via PyO3 — not directly embeddable in Node.** But Rust compiles
  to WebAssembly, and WASM runs natively inside Node with no extra runtime.
  The blockers to a straight WASM build (`rayon` parallelism, `tree-sitter`
  code parsing, `oniguruma`'s C regex) turned out to be constraints *headroom
  needs for its own Python-parity test suite*, not constraints optiflow
  inherits — optiflow isn't trying to byte-match headroom's Python package,
  so dropping rayon's parallelism (a single hook invocation compressing one
  command's output doesn't need multi-core) and swapping `tokenizers`' C
  regex backend for its own `unstable_wasm` feature cost nothing optiflow
  actually needed. CodeCompressor (tree-sitter-based) and the Kompress ML
  model were the two pieces genuinely worth re-implementing natively in
  TypeScript rather than fighting into the same WASM build — see
  `native/headroom-core/Cargo.toml`'s feature flags and
  `docs/ADR/0002-real-merge-not-orchestration.md` for the full evidence
  trail.

The real cost paid for this: a Rust toolchain + `wasm-pack` as a build-time
dependency, and genuine engineering effort porting ~12,000 lines of
token-optimizer's enforcement-hook logic and headroom's compression core —
not multi-week/high-risk in the way v1 assumed, but not free either.

## Authority map

Each concern has exactly one owner. "token-optimizer" below means the merged
code living in `src/optimizer/` — not an external process:

| Concern | Owner |
|---|---|
| File read/write/grep/glob caching, build/test/lint/typecheck, and the other 76 `smart_*`/analytics/dashboard-monitoring MCP tools | `src/optimizer/tools/` (merged token-optimizer source), served by optiflow's own MCP server |
| `PreToolUse` enforcement (deny/redirect built-in `Read/Grep/Glob/Edit/MultiEdit/Write/Bash/PowerShell` toward the tools above) | `src/optimizer/hooks/pretooluse.ts` (merged token-optimizer enforcement logic — matcher `Read\|Grep\|Glob\|Edit\|MultiEdit\|Write\|Bash\|PowerShell`) |
| Token accounting / knowledge graph (wiki store) | `src/optimizer/analytics/**`, `src/optimizer/hooks/lib/wiki.ts` — optiflow's own, not a read-only view into an external system |
| Semantic/AST code compression | `src/native/code-compressor.ts` (TypeScript + `web-tree-sitter`, not headroom's Rust `tree-sitter` integration) |
| JSON/text statistical compression (SmartCrusher) | `native/headroom-wasm/` — the real forked Rust algorithm, compiled to WASM, called from `src/native/smart-crusher.ts` |
| ML-based compression (Kompress) | `src/native/kompress.ts` (`onnxruntime-node` + `transformers.js`, opt-in/download-on-first-use — not headroom-core's Rust `ml` feature) |
| CCR (reversible compression) storage | `src/native/ccr-store.ts` — Node-side (SQLite/JSON), not headroom's Rust storage backends |
| Generic CLI output (git/docker/kubectl/npm/terraform/tests) | optiflow Module 1 (chop) — `Bash`-only `PreToolUse`, disjoint fields from the enforcement hook above (see Module 1 below) |
| Transcript-file token/cache analytics (client-side, from Claude Code's own `.jsonl` transcripts) | optiflow Module 2 (report) — a different vantage point than `src/optimizer/analytics/**` above, which only sees the merged tools' own savings |
| Session checkpoint artifacts (`.optiflow/checkpoints/`) | optiflow Module 4 (handoff) |

optiflow's `PreToolUse` intercepts on TWO separate, co-registered hooks with
disjoint output fields (both can safely fire on the same `Bash` call — see
Module 1 below): the merged enforcement hook (`Read\|Grep\|Glob\|Edit\|
MultiEdit\|Write\|Bash\|PowerShell`, emits `permissionDecision`/
`additionalContext`) and chop (`Bash` only, emits `updatedInput`).

## optiflow's own five modules

1. **Chop-style Bash interception** (`src/chop/**`) — rewrites `Bash`
   `command` via `PreToolUse` `updatedInput`, but only for a single simple
   command whose first token is on an allowlist and contains none of
   `&& || ; | > < $( ) `` & \n`. Compound commands pass through untouched.
   Disabled by default globally; only enabled inside a project with an
   explicit `optiflow.config.json`, because rewriting `command` changes what
   the permission system matches against. Co-registers safely alongside the
   merged optimizer's own broader `PreToolUse` enforcement hook (see
   Authority map above) — the two emit disjoint response fields.
2. **Session-report analytics** (`src/transcript/**`, `optiflow report`) —
   parses `~/.claude/projects/<slug>/*.jsonl` transcripts directly. This is a
   disjoint data source from `src/optimizer/analytics/**` (which only
   records savings from the merged tools' own calls); `--include-optimizer`
   joins by `sessionId` rather than recomputing anything.
3. **Status-line context meter** (`src/statusline/**`) — renders Claude
   Code's statusline in under 100ms (300ms debounce window), so this path
   imports zero native dependencies. Must handle `used_percentage === null`
   (before the first turn, or right after `/compact`).
4. **`/optiflow:compact-continue` handoff** (`src/handoff/**`) — checkpoints
   session state to `.optiflow/checkpoints/` on `PreCompact`/`SessionEnd`.
   Co-registers alongside the merged optimizer's own `PreCompact` hook
   (`src/optimizer/hooks/precompact.ts`) on the same event.
5. **TOON conversion** (`src/toon/**`) — wraps `@toon-format/toon` (does not
   reimplement the encoder); only replaces JSON/CSV output when measured
   token savings clear a threshold, since TOON can be larger than JSON on
   non-uniform data.

## Locked decisions (v2)

- Real merge, not an orchestration wrapper — see "Why a merge, not an
  orchestrator" above and `docs/ADR/0002-real-merge-not-orchestration.md`.
- A Rust toolchain + `wasm-pack` + the `wasm32-unknown-unknown` target are
  build-time dependencies (CI installs them; see `.github/workflows/ci.yml`).
  Nothing at runtime needs Rust/Python/a separate `headroom` binary/`npx`.
- License: MIT for optiflow-mcp's own code. Both upstream `LICENSE` files are
  retained; headroom's `NOTICE` is propagated per Apache-2.0 §4(d) for the
  Rust source copied into `native/headroom-core/`; token-optimizer-mcp's MIT
  license is retained for the source copied into `src/optimizer/`. See
  `THIRD_PARTY_LICENSES.md`.
- `vendor/token-optimizer-mcp` and `vendor/headroom` git submodules are kept
  for provenance/reference (license text, a record of exactly what was
  ported from where) but are not on optiflow's runtime or build import path.

## Repository layout

See the repository root for the current layout. At a glance:

- `plugin/` — the installable Claude Code plugin (hooks, commands, scripts,
  bin shims, and `dist/` — committed esbuild output, so installs never build).
- `src/optimizer/` — the merged token-optimizer-mcp source: 76 MCP tools
  (`tools/`), analytics (`analytics/`), and the ported `PreToolUse`/
  `PreCompact` enforcement hooks (`hooks/`), all reconciled to optiflow's own
  path/config conventions.
- `src/native/` — TypeScript wrappers/ports around headroom's compression
  capability: `smart-crusher.ts` (calls into the WASM module),
  `code-compressor.ts` (native TS + `web-tree-sitter`), `kompress.ts`
  (`onnxruntime-node`), `ccr-store.ts` (Node-side reversible-compression
  storage).
- `native/` — the Rust side: `headroom-core/` (headroom's compression engine,
  forked and feature-stripped) and `headroom-wasm/` (the `wasm-bindgen`
  binding crate `wasm-pack` compiles to a `.wasm` module).
- `src/` (everything else) — TypeScript source for optiflow's own five
  modules plus shared `config/` and `core/` utilities.
- `fixtures/` — golden stdin/stdout payloads used as the primary test
  strategy (every hook is a stdin -> stdout program).
- `vendor/` — the two upstream projects as git submodules, provenance only
  (not imported/required by anything under `src/` or `native/`).
- `docs/ADR/` — architecture decision records.
