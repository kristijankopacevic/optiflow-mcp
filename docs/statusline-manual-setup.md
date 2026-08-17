# Manual statusline setup

Claude Code's `statusLine` setting is **single-valued and global** — it lives
only in your own `~/.claude/settings.json` (user-level) or a project's
`.claude/settings.json` (project-level), never in a plugin manifest. See
`docs/modules.md`'s "Activating the statusline" section for how that was
confirmed (U1). This means installing the optiflow plugin does **not**, by
itself, turn on optiflow's statusline.

## Preferred: `optiflow install --statusline`

The now-preferred way to activate it is the real installer
(`src/install/settings-writer.ts` + `optiflow install`, Phase 8):

```powershell
optiflow install --statusline
```

This backs up your existing `~/.claude/settings.json` to
`settings.json.optiflow-backup-<timestamp>` before writing, writes
atomically (temp file + rename — a crash mid-write can't corrupt your
settings), and preserves every other key untouched. If a *different*
statusLine is already configured, it refuses and tells you so rather than
silently overwriting it; pass `--force` to back it up and overwrite anyway.
Running it again when optiflow's statusline is already active is a no-op
(no duplicate backups). `optiflow install` with neither `--statusline` nor
`--no-statusline` touches nothing and just prints these manual instructions
— see `optiflow install --help` for the full flag list (including
`--settings-path` to target a project-level settings file instead of the
user-global one).

To reverse it, `optiflow uninstall` restores the settings.json backup taken
at install time (or removes just the `statusLine` key if optiflow activated
it on a machine that had no prior settings.json to back up).

## Manual setup (still supported — no CLI required)

The rest of this document covers doing it by hand with a text editor, for
anyone who wants full control or is on a machine without this CLI installed.

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
script), adding optiflow's `statusLine` by hand this way overwrites it with
no backup — you lose the old one unless you back it up yourself first.
(`optiflow install --statusline`, above, backs this up for you
automatically — that's the main reason it's now the preferred path.)

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
