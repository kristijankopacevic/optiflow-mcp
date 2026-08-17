---
description: Combined save-then-restore session handoff (Module 4) — checkpoint now, then immediately render a resume-ready summary in one shot.
argument-hint: "[notes]"
---

Run optiflow's combined checkpoint-and-restore handoff and show the result to
the user.

The real command is `/optiflow:compact-continue` (plugin-namespaced — there
is no bare `/compact-continue`; see `docs/modules.md` for how a user could
add one under `~/.claude/commands/` themselves if they want it, which this
plugin does not do on their behalf). It does exactly two things, in order:

1. Saves a new checkpoint right now — same as `/optiflow:checkpoint
   "$ARGUMENTS"` — capturing the current git branch/HEAD, cwd, a reference to
   token-optimizer-mcp's own session state, and `$ARGUMENTS` (if any) as the
   checkpoint's `decisions[]` entry.
2. Immediately renders that checkpoint back as the same resume-ready markdown
   `/optiflow:restore` produces (capped at 10,000 chars by default).

Run:

```
optiflow checkpoint "$ARGUMENTS"
optiflow checkpoint --restore
```

**Important — this command does NOT trigger compaction.** It only prepares
for one (or for a session ending): it snapshots state and shows the user
what a fresh session would see if it resumed from this checkpoint right now.
If the user's actual goal is to compact or end the session, they still need
to do that themselves (e.g. `/compact`, or simply ending the session) — this
command is the "make sure a checkpoint exists and looks right before that
happens" step, not a replacement for it.

Tell the user the checkpoint id from step 1, then show the rendered markdown
from step 2 so they can confirm it captures what they'd want to resume with.
