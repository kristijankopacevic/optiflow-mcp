# ADR 0001: Provenance-only submodules; pinned npx / optional PATH binary at runtime

## Status

**Superseded by [ADR 0002](0002-real-merge-not-orchestration.md)** (v2,
2026-08-18) — the user explicitly rejected the orchestration-wrapper
architecture this ADR describes. token-optimizer-mcp's source is now merged
directly into `src/optimizer/` (no `npx`) and headroom's compression core is
forked into `native/headroom-core/` and compiled to WebAssembly (no `headroom`
binary on PATH). This document is kept for historical record of why v1 made
the choice it did — the reasoning below was sound given what was known at the
time (see ADR 0002 for what new evidence changed the decision).

Originally accepted (Phase 0/1 scaffold, 2026-08-17).

## Context

optiflow-mcp combines two upstream tools: token-optimizer-mcp (Node/TS, ships
a native `better-sqlite3` dependency) and headroom (Rust/Python). Two
integration strategies were available:

1. Add both as git submodules and build them from source as part of
   optiflow's own build.
2. Add both as git submodules for provenance/reference only, but invoke them
   at runtime via already-published distribution channels: a version-pinned
   `npx` for token-optimizer-mcp, and the `headroom` binary from PATH (if the
   user has installed it) for headroom.

Option 1 would force `better-sqlite3` native compilation against this
machine's Node version (v24.15.0) on Windows, a combination not verified
upstream at plan-writing time. Option 2 avoids that risk entirely by relying
on whatever the upstream project already publishes (npm package with
prebuilt native bindings, or a separately-installed binary).

## Decision

Use Option 2: submodules under `vendor/` are provenance-only and are never
built. Runtime invocation is:
- `npx -y @ooples/token-optimizer-mcp@5.7.0` (version-pinned, never `@latest`)
- `headroom mcp serve` from PATH, treated as optional — `optiflow doctor`
  warns but does not fail when absent.

## Phase 0 probe results (this machine: Node v24.15.0, npm 11.12.1, Windows 11)

### 1. `npx -y @ooples/token-optimizer-mcp@5.7.0 --version` / `--help`

Ran successfully, exit code 0, both with `--version` and `--help`. However,
the package does **not** implement either flag: in both cases it ignored the
argument, started its stdio MCP server, and then printed
`[token-optimizer] shutting down (stdin end)` and exited 0 once stdin closed
(this test harness closes stdin immediately after invocation). The only
warning emitted was an unrelated `npm warn deprecated glob@11.1.0` transitive
dependency notice — not an error.

Inspected the resolved package tree in the npx cache
(`~/AppData/Local/npm-cache/_npx/<hash>/node_modules/better-sqlite3/`):
a `prebuilds/win32-x64.node` file is present and there is **no**
`build/Release/` directory. This means npm installed a prebuilt native
binary for `better-sqlite3` on this Node 24/Windows combination — **no
node-gyp compilation occurred**. This is evidence that the specific install
path taken by `npm`/`npx` here is clean on this machine; it does not by
itself prove that a from-source build would also succeed (that path was not
exercised), so it strengthens the *outcome* of the "pin, don't build"
decision without validating the original risk claim about source builds.

**Downstream consequence for Phase 2 (`optiflow doctor`):** since neither
`--version` nor `--help` is handled, `optiflow doctor` cannot detect an
installed/reachable token-optimizer-mcp by parsing version-flag output. It
will need a different detection strategy (e.g. checking `npx` cache presence,
or a short-lived MCP handshake over stdio) — noted here as a concrete
constraint for whoever implements Phase 2.

### 2. `headroom --version`

`headroom` is **not** on PATH on this machine (`Get-Command headroom` found
nothing). Expected and fine — headroom is optional per the plan; `optiflow
doctor` and module runtime checks must discover it at runtime rather than
assuming it exists.

### 3. `gh --version`

`gh` is **not** on PATH on this machine. Expected and fine — all `gh`-auth-
dependent steps (forking, repo creation, push) are isolated to the final
publish phase and are explicitly out of scope for Phase 0/1. No install or
auth attempt was made.

## Consequences

- No blocking issues found for Phase 0/1. Both "expected absent" probes
  (`headroom`, `gh`) confirmed absence as predicted by the plan.
- The token-optimizer-mcp npx probe found no native-build failure, which is a
  positive signal for the "pin instead of build" decision, but the ADR
  explicitly avoids overclaiming: a from-source build of the vendored
  submodule was never attempted, so its risk status is unchanged (still
  avoided by design, not disproven as safe).
- `optiflow doctor`'s detection strategy for token-optimizer-mcp cannot rely
  on `--version`/`--help` output parsing; flagged for Phase 2 design.
