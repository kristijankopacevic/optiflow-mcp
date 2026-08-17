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

Early scaffold. This repository is being built in phases; only the skeleton
(directory layout, package/build config, plugin manifests, licensing) exists
so far. `npm run build` will not fully succeed until later phases add the
module source files it references — see `esbuild.config.mjs` for the current
behavior (it skips missing entry points and warns rather than failing).

## License

MIT for optiflow-mcp's own code (see [`LICENSE`](LICENSE)). This repository
also aggregates references to MIT-licensed (token-optimizer-mcp) and
Apache-2.0-licensed (headroom) upstream projects — see
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) and
[`NOTICE`](NOTICE).
