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

Published at [github.com/kristijankopacevic/optiflow-mcp](https://github.com/kristijankopacevic/optiflow-mcp).
Verified end-to-end via a local-path marketplace (no `gh` auth needed for
that):

1. In a Claude Code session, add this repo as a marketplace and install the
   plugin:
   ```
   /plugin marketplace add C:\path\to\optiflow-mcp
   /plugin install optiflow@optiflow
   ```
2. Check your environment:
   ```powershell
   optiflow doctor
   ```
   Reports Node/npm versions, config resolution, and `gh` presence/auth.
3. Activate the statusline (optional, opt-in — installing the plugin alone
   does not touch your settings.json):
   ```powershell
   optiflow install --statusline
   ```
   Backs up your `~/.claude/settings.json` before writing, writes
   atomically, and refuses to overwrite a different existing statusline
   without `--force`. `optiflow uninstall` reverses it. See
   [`docs/statusline-manual-setup.md`](docs/statusline-manual-setup.md) for
   details (including doing it by hand) and
   [`docs/modules.md`](docs/modules.md) for the rest of the modules.

See [`docs/`](docs/) for architecture, configuration, and per-module
reference depth beyond this quick start.

## License

MIT for optiflow-mcp's own code (see [`LICENSE`](LICENSE)). This repository
also copies in source from MIT-licensed (token-optimizer-mcp) and
Apache-2.0-licensed (headroom) upstream projects — see
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) and
[`NOTICE`](NOTICE).
