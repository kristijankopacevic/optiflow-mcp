---
description: Render the most recent (or a specified) session-handoff checkpoint (Module 4) as markdown, for resuming in a fresh session.
argument-hint: "[checkpoint-id]"
---

Render an optiflow session-handoff checkpoint and show it to the user
verbatim so they can resume work — this is meant to be pasted/read at the
start of a fresh session after a compaction or a prior session ended.

The real command is `/optiflow:restore` (plugin-namespaced — there is no
bare `/restore`). With no argument it renders the MOST RECENT checkpoint in
the current project's `.optiflow/checkpoints/`; with an argument, it matches
either a full checkpoint id or a bare session id prefix.

Run:

```
optiflow checkpoint --restore "$ARGUMENTS"
```

If it prints "No checkpoints found yet," say so plainly and suggest running
`/optiflow:checkpoint [notes]` first — this is a normal state for a project
that has never compacted/ended a session under optiflow, not an error.

Note on the token-optimizer state reference the output includes: it is a
REFERENCE (a file path + the sessionId key to look it up under), not a copy
of token-optimizer-mcp's own session content — resolving it may show
"did not exist at checkpoint time" if token-optimizer wasn't tracking that
session, which is an honest, expected outcome, not a bug.
