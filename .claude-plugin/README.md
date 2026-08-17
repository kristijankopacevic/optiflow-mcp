# .claude-plugin/marketplace.json — notes

`marketplace.json` registers only the `optiflow` plugin (source `./plugin`).

Per the plan's Risk R8 (marketplace collision): token-optimizer-mcp and
headroom each ship their own `.claude-plugin/marketplace.json`. Registering
their plugins a second time from optiflow's marketplace would double-register
them. optiflow does **not** re-list them here — instead it talks to them as
MCP servers, wired up in `plugin/.mcp.json` (pinned `npx` package for
token-optimizer, optional `headroom` binary on PATH), which is Phase 2+ work.

The `owner`/`metadata`/`plugins[].source` schema (a bare `"./relative/path"`
string, or an object with `source: "url" | "git-subdir"`) was
reverse-engineered from real installed marketplaces on this machine
(`claude-hud`, `n8n-io`, `claude-plugins-official`), since the plan document
doesn't specify the marketplace.json schema directly.
