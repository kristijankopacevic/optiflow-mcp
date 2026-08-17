# Architecture

## What optiflow-mcp is

optiflow-mcp is a thin Node/TypeScript orchestration layer for Claude Code. It
does not re-implement token optimization or compression itself. Instead it:

1. Wires two existing upstream tools together under one plugin/config:
   - **token-optimizer-mcp** (Node/TS MCP server + hooks, 74+ `smart_*`
     tools, SQLite-backed analytics, dashboard on `:3100`) — invoked at
     runtime via a version-pinned `npx`, never built from the vendored
     submodule.
   - **headroom** (Rust/Python compression pipeline, MCP server, proxy,
     agent-wrapper) — invoked via the `headroom` binary from PATH when
     present; entirely optional.
2. Adds five modules that own ground neither upstream tool covers.

Both upstream projects are referenced as git submodules under `vendor/` for
provenance only — their code is never modified, built, or copied into
optiflow's own source tree.

## Why an orchestrator, not a merge

A literal code-level merge of a Node/TS enforcement engine and a Rust/Python
compression engine would be a multi-week effort with high architectural risk
(different runtimes, different build systems, different maintenance
cadences). The orchestrator approach keeps both upstreams unmodified and
independently upgradable, and lets optiflow-mcp focus on the integration
surface: Claude Code's hook, plugin, and MCP mechanisms.

## Authority map

Each concern has exactly one owner, to avoid optiflow duplicating work either
upstream tool already does:

| Concern | Owner |
|---|---|
| File read/write/grep/glob caching | token-optimizer `smart_*` tools |
| Build/test/lint/typecheck | token-optimizer `smart_build`/`smart_test`/etc. |
| Semantic/AST code + JSON compression | headroom (`CodeCompressor`, `SmartCrusher`) |
| Token accounting DB / knowledge graph / dashboard | token-optimizer (optiflow is a read-only consumer) |
| Generic CLI output (git/docker/kubectl/npm/terraform/tests) | optiflow Module 1 (chop) |
| `Bash` `updatedInput` rewriting | optiflow Module 1 (verified unclaimed: token-optimizer's `PreToolUse` router never emits it) |
| Transcript-file token/cache analytics | optiflow Module 2 (report) |
| Session checkpoint artifacts (`.optiflow/checkpoints/`) | optiflow Module 4 (handoff) |

optiflow never intercepts `Read`, `Grep`, `Glob`, `Edit`, or `Write` — those
stay entirely with token-optimizer.

## The five modules

1. **Chop-style Bash interception** (`src/chop/**`) — rewrites `Bash`
   `command` via `PreToolUse` `updatedInput`, but only for a single simple
   command whose first token is on an allowlist and contains none of
   `&& || ; | > < $( ) `` & \n`. Compound commands pass through untouched.
   Disabled by default globally; only enabled inside a project with an
   explicit `optiflow.config.json`, because rewriting `command` changes what
   the permission system matches against.
2. **Session-report analytics** (`src/transcript/**`, `optiflow report`) —
   parses `~/.claude/projects/<slug>/*.jsonl` transcripts directly. This is a
   disjoint data source from token-optimizer's own analytics DB (which only
   records savings from its own tools); `--include-optimizer` joins by
   `sessionId` rather than recomputing anything.
3. **Status-line context meter** (`src/statusline/**`) — renders Claude
   Code's statusline in under 100ms (300ms debounce window), so this path
   imports zero native dependencies. Must handle `used_percentage === null`
   (before the first turn, or right after `/compact`).
4. **`/optiflow:compact-continue` handoff** (`src/handoff/**`) — checkpoints
   session state to `.optiflow/checkpoints/` on `PreCompact`/`SessionEnd`.
   Stores a reference to token-optimizer's own state, never a re-serialized
   copy, since both tools may hook `PreCompact` simultaneously.
5. **TOON conversion** (`src/toon/**`) — wraps `@toon-format/toon` (does not
   reimplement the encoder); only replaces JSON/CSV output when measured
   token savings clear a threshold, since TOON can be larger than JSON on
   non-uniform data.

## Locked decisions

- Orchestration wrapper, not a deep merge; both upstreams stay unmodified.
- Runtime uses upstream npm/CLI (pinned `npx`, `headroom` from PATH), never a
  build of the vendored submodules — see
  `docs/ADR/0001-provenance-only-submodules.md` for the reasoning and the
  Phase 0 probe results that inform it.
- License: MIT for optiflow-mcp itself; both upstream `LICENSE` files are
  retained and headroom's `NOTICE` is propagated per Apache-2.0 §4(d).
- GitHub steps needing `gh` auth (forking, repo creation, push) are isolated
  to the final build phase; everything before that uses only `git`.

## Repository layout

See the repository root for the current layout. At a glance:

- `plugin/` — the installable Claude Code plugin (hooks, commands, scripts,
  bin shims, and `dist/` — committed esbuild output, so installs never build).
- `src/` — TypeScript source for all five modules plus shared `config/` and
  `core/` utilities.
- `fixtures/` — golden stdin/stdout payloads used as the primary test
  strategy (every hook is a stdin -> stdout program).
- `vendor/` — the two upstream projects as git submodules, provenance only.
- `docs/ADR/` — architecture decision records.
