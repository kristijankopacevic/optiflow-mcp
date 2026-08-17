# optiflow-mcp

An orchestration layer for Claude Code that combines two existing
token-optimization tools — [token-optimizer-mcp](https://github.com/ooples/token-optimizer-mcp)
and [headroom](https://github.com/headroomlabs-ai/headroom) — under one
plugin/config, and adds five modules that neither upstream tool covers:

1. Chop-style Bash/CLI-output interception (git, docker, kubectl, npm,
   terraform, test runners)
2. Session-report-style transcript analytics (`optiflow report`)
3. A statusline context meter (renders in under 100ms)
4. `/optiflow:compact-continue` session-handoff checkpoints
5. TOON conversion for large JSON/CSV/YAML payloads

Both upstream projects are referenced as git submodules under `vendor/` for
provenance only — their code is never modified. At runtime, optiflow-mcp
invokes token-optimizer-mcp via a version-pinned `npx` and headroom via the
`headroom` binary on PATH (optional), rather than building either submodule.

See [`docs/architecture.md`](docs/architecture.md) for the full design
rationale, authority map, and locked decisions.

## Status

All five modules, core/config, `optiflow doctor`, and the real
`optiflow install`/`optiflow uninstall` installer are built and committed.
`npm run build`, `npm test` (452 tests), and `npx tsc --noEmit` all pass.
Remaining/known gaps: `optiflow init`, `optiflow chop`, and `optiflow
statusline` are still stub subcommands (their real logic already exists as
importable modules/hooks — see `src/chop/**`/`src/statusline/**` — just not
yet wired to a direct CLI entry point of their own); the final `gh`-authenticated
publish sequence (fork/push to a public repo) hasn't run yet. See the plan's
build-order table and `docs/modules.md` for per-module detail.

## Getting started

This has only been exercised via a **local-path marketplace** so far (no
`gh` auth needed for any of this):

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
   Reports Node/npm versions, config resolution, the token-optimizer version
   pin vs. the vendored submodule, headroom presence, a headroom-wrap
   conflict warning (plan Risk R1), and `gh` presence/auth.
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
also aggregates references to MIT-licensed (token-optimizer-mcp) and
Apache-2.0-licensed (headroom) upstream projects — see
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) and
[`NOTICE`](NOTICE).
