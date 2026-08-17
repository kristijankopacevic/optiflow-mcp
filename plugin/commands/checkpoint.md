---
description: Save a session-handoff checkpoint (Module 4) — git branch/HEAD, cwd, a reference to token-optimizer-mcp's own session state, and optional free-text notes.
argument-hint: "[notes]"
---

Save an optiflow session-handoff checkpoint and tell the user where it was
written.

The real command Claude Code exposes for this is `/optiflow:checkpoint` (the
plugin namespace prefix is not optional — there is no bare
`/checkpoint`). It writes a JSON file under `.optiflow/checkpoints/` in the
current project, containing:

- the current git branch/HEAD (auto-derived via real `git` calls; `null`
  if `cwd` isn't a repo or has no commits yet),
- the current working directory,
- `$ARGUMENTS` (if any) as the checkpoint's sole `decisions[]` entry — this
  is the ONLY way `decisions[]`/`nextSteps[]`/`openFiles[]` get populated;
  a hook-triggered auto-checkpoint (on `PreCompact`/`SessionEnd`) can never
  supply free-text like this, so if the user wants a next-session-ready
  summary, `$ARGUMENTS` matters,
- a REFERENCE to token-optimizer-mcp's own session state (never a copy of
  it — see `docs/modules.md`).

Run:

```
optiflow checkpoint "$ARGUMENTS"
```

After it runs, tell the user the checkpoint id it printed and that
`/optiflow:restore` (or `/optiflow:restore <id>`) will render it back later,
in a fresh session if needed.
