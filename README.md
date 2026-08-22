# optiflow-mcp

A single Claude Code plugin, one MCP server, one repository — not a wrapper
around separately-installed tools. It genuinely merges the real source of
two upstream projects into its own codebase:

1. **[token-optimizer-mcp](https://github.com/ooples/token-optimizer-mcp)'s**
   76 real `smart_*`/analytics/dashboard-monitoring MCP tools, plus its
   `PreToolUse`/`PreCompact` enforcement hooks, ported directly into
   `src/optimizer/` — no `npx` install, no separate process.
2. **[headroom](https://github.com/headroomlabs-ai/headroom)'s** actual Rust
   compression core (`SmartCrusher`) forked into `native/headroom-core/`,
   feature-stripped, and compiled to real WebAssembly
   (`native/headroom-wasm/`) loaded directly by the Node plugin — the genuine
   Rust algorithm, not a rewrite. headroom's CodeCompressor and Kompress ML
   model are reimplemented natively in TypeScript instead (`src/native/`).
3. Five modules of its own that neither upstream tool covered: chop-style
   Bash/CLI-output interception, session-report transcript analytics, a
   statusline context meter, `/optiflow:compact-continue` session-handoff
   checkpoints, and TOON conversion for large JSON/CSV/YAML payloads.

Both upstream projects are still referenced as git submodules under
`vendor/` for provenance/license text, but nothing under `src/` or `native/`
imports from `vendor/` — see
[`docs/ADR/0002-real-merge-not-orchestration.md`](docs/ADR/0002-real-merge-not-orchestration.md)
for why this replaced the original orchestration-wrapper design (v1), and
[`docs/architecture.md`](docs/architecture.md) for the full authority map and
locked decisions.

## Status

The MCP server serves **77** tools: the 76 vendored above, plus optiflow's
own `ccr_retrieve`, which resolves the `<<ccr:HASH ...>>` markers lossy
compression leaves behind (`src/native/ccr-tool.ts`).

Both major merges are done and wired: the 76-tool + enforcement-hook merge
from token-optimizer-mcp, and headroom's compression core (WASM SmartCrusher
+ TS CodeCompressor/Kompress) actually called from the shipped pipeline, not
just built in isolation. `npm run build`, `npm test`, and `npx tsc --noEmit`
all pass — see `docs/modules.md` for per-module detail and current test
count. Building from source needs a Rust toolchain (`rustup`, the
`wasm32-unknown-unknown` target, `wasm-pack`) in addition to Node; a plugin
install does not (the compiled `.wasm` is committed, same reasoning as
`plugin/dist/`).

## Getting started

Works identically in the Claude Code CLI and in the VS Code / JetBrains
extensions — they run the same engine, so there is no separate install.

```
/plugin marketplace add kristijankopacevic/optiflow-mcp
/plugin install optiflow@optiflow
```

Then restart the session (MCP servers and hooks are wired at startup) and
check `/mcp` — `plugin:optiflow:optiflow-optimizer` should read **Connected**.

### Requirements

**Node 18 or newer**, and nothing else. The plugin ships pre-built: the
JavaScript bundles under `plugin/dist/` and the compiled `.wasm` are committed,
so an install never runs a build, and no `node_modules` is required at runtime.

Two optional native accelerators are used **if** they happen to be resolvable
and degrade silently if not:

| Accelerator | Gives you | Without it |
|---|---|---|
| `better-sqlite3` | cache that survives restarts | in-memory cache, per process |
| `tiktoken` | exact token counts | heuristic estimate (chars/4) |

Run `optiflow doctor` to see which are active. Both need Node ≥22 to build, so
on Ubuntu LTS (Node 18) expect them to be absent — the plugin is fully
functional either way; compression still runs and is still measured.

To enable them anyway:

```bash
cd ~/.claude/plugins/cache/optiflow-mcp/optiflow/*/ && npm install better-sqlite3 tiktoken
```

### Linux notes

Nothing special is required, but two things are worth knowing:

- Claude Code's automatic plugin dependency install runs `npm ci --ignore-scripts`,
  which cannot build native addons. That is why the accelerators above are
  optional rather than dependencies.
- CI runs the full isolated-install check on Ubuntu against Node 18, 20 and 22,
  so the shipped tree is verified to start on the Node your distro provides.

### Optional extras

```bash
optiflow doctor              # environment + which accelerators are active
optiflow install --statusline # opt in to the context-meter statusline
optiflow savings --watch     # live view of what compression actually saved
```

To get the `optiflow` command in a normal terminal (independent of the
plugin install, reading the same ledger), run the installer once:

```bash
curl -fsSL https://raw.githubusercontent.com/kristijankopacevic/optiflow-mcp/master/scripts/install-cli.sh | bash
```

Or, if you would rather read it before running it (reasonable), download
`scripts/install-cli.sh` and run it yourself. After that first install,
updating is just:

```bash
optiflow update
```

Both do the same three things, which all have to be right or you get an error
that looks like a broken build: install from the **tarball URL** (never
`npm install -g github:...`, which npm symlinks to a temp clone it then
deletes), remove any stale `alias optiflow=...` shadowing the binary, and
verify the result is actually the current build.

Installing the plugin alone never touches your `settings.json`; the statusline
is explicit opt-in, backs up your settings first, and `optiflow uninstall`
reverses it. See [`docs/statusline-manual-setup.md`](docs/statusline-manual-setup.md)
and [`docs/modules.md`](docs/modules.md).

For what runs by default, what is off and why, and how to turn everything on,
see [`docs/enabling-everything.md`](docs/enabling-everything.md).

## License

MIT for optiflow-mcp's own code (see [`LICENSE`](LICENSE)). This repository
also copies in source from MIT-licensed (token-optimizer-mcp) and
Apache-2.0-licensed (headroom) upstream projects — see
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) and
[`NOTICE`](NOTICE).
