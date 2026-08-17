# .claude-plugin/marketplace.json — TODO

`marketplace.json` must be valid JSON, so this note lives here instead of an
inline `//` comment in that file.

- The `token-optimizer` and `headroom` plugin entries use `<user>` as a
  placeholder in `source.url` (e.g.
  `https://github.com/<user>/token-optimizer-mcp.git`) because the forks
  referenced by the plan's Phase 8 publish sequence do not exist yet.
- Once `gh repo fork ooples/token-optimizer-mcp` and
  `gh repo fork headroomlabs-ai/headroom` have run (Phase 8), replace
  `<user>` in both `source.url` fields with the actual GitHub account, and
  add a `sha` pin per the schema used by the official marketplace
  (`{ "source": "url", "url": "...", "sha": "<commit>" }`).
- The `marketplace.json` schema above (`owner`, `metadata`, `plugins[].source`
  as either a bare `"./relative/path"` string or an object with
  `source: "url" | "git-subdir"`) was reverse-engineered from real installed
  marketplaces on this machine (`claude-hud`, `n8n-io`,
  `claude-plugins-official`) — the plan document referenced for this shape
  ("§6 in the design research") does not exist in
  `create-an-forked-app-snappy-panda.md` as delivered. Flagging this so the
  coordinator can confirm or correct the schema before Phase 2 depends on it.
