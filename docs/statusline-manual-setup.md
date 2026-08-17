# Manual statusline setup (Phase 4 / Module 3)

Claude Code's `statusLine` setting is **single-valued and global** — it lives
only in your own `~/.claude/settings.json` (user-level) or a project's
`.claude/settings.json` (project-level), never in a plugin manifest. See
`docs/modules.md`'s "Activating the statusline" section for how that was
confirmed (U1). This means installing the optiflow plugin does **not**, by
itself, turn on optiflow's statusline — you (or, later, `optiflow install`
in Phase 8, with proper backup/restore) need to add one JSON key by hand.

## The key to add

Add (or replace) the top-level `statusLine` key in `~/.claude/settings.json`
(or your project's `.claude/settings.json` if you only want it scoped to one
project):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<path-to-optiflow-mcp>/plugin/scripts/statusline.mjs\"",
    "padding": 0
  }
}
```

Replace `<path-to-optiflow-mcp>` with wherever this repo/plugin is actually
installed on disk — use a **literal absolute path**, not
`${CLAUDE_PLUGIN_ROOT}`. Verified directly against the installed Claude Code
binary on this machine: `${CLAUDE_PLUGIN_ROOT}` substitution requires a
specific plugin's install path, which is only ever threaded through the
hook/skill/MCP-server execution call paths (the function that does the
substitution takes a plugin object with a `.path` field). The `statusLine`
execution path pulls its command straight from the merged user/project
settings object and calls the same generic command-runner with no plugin
object in its argument list at all — there is no plugin path available to
substitute, structurally, not just unconfirmed. `${CLAUDE_PLUGIN_ROOT}` will
not expand inside `statusLine.command`; it will either be left as the
literal string `${CLAUDE_PLUGIN_ROOT}` or fail to resolve to a file. Use the
absolute path.

## Important: this REPLACES whatever `statusLine` you already have

`statusLine` is a single key — there is no way to have two statuslines at
once. If you already have a `statusLine` configured (for example, this very
machine's `~/.claude/settings.json` already has one pointed at an unrelated
script), adding optiflow's `statusLine` overwrites it; you lose the old one
unless you back it up yourself first.

**This phase deliberately does not touch your real settings.json at all** —
no script here reads or writes it. Automating this safely (backup before
write, restore on `optiflow uninstall`) is explicitly Phase 8
(`src/install/**`)'s job per the plan, not this phase's. Until Phase 8
ships, adding/removing this key is a manual, deliberate action you take with
a text editor.

## Verifying it worked

After editing settings.json and restarting Claude Code (or running
`/reload-plugins` if that's sufficient for a settings.json change — untested
on this machine), the statusline at the bottom of the Claude Code UI should
show something like:

```
[███░░░░░░░] 34% │ Claude Opus 4.1 │ $1.23
```

or, before the first API call in a session / immediately after `/compact`:

```
[░░░░░░░░░░] --% │ Claude Opus 4.1 │ $0.00
```

You can also test the script directly, without Claude Code, by piping a
realistic payload into it on stdin (see `fixtures/statusline/*.json` for
example payloads):

```powershell
Get-Content fixtures\statusline\normal.json -Raw | node plugin\scripts\statusline.mjs
```

## Configuring segments/order/width

See `docs/modules.md`'s "Config" section — `statusline.segments`,
`statusline.meterWidth`, and `statusline.activityStaleMs` can be set in
`~/.optiflow/config.json` or a project's `optiflow.config.json`, e.g.:

```json
{
  "statusline": {
    "segments": ["meter", "cost"],
    "meterWidth": 20
  }
}
```
