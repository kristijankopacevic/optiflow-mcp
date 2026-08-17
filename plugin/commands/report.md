---
description: Transcript token/cache analytics report (Module 2) — totals, cache-break detection, subagent rollup, and top costliest turns from ~/.claude/projects/**/*.jsonl.
argument-hint: "[--session <id>] [--all] [--range 7d] [--format table|json|md] [--top 10] [--include-optimizer]"
---

Run optiflow's transcript analytics report and show the result to the user.

This parses Claude Code's own local transcript files
(`~/.claude/projects/<slug>/<sessionId>.jsonl`) directly — a disjoint data
source from token-optimizer-mcp's analytics DB, which only records what its
own `smart_*` tools saved. This report is about prompt/cache economics for
the actual conversation(s): total tokens per session, where the prompt
cache broke (had to be re-primed instead of reused), subagent/Task-tool
token usage separated from the main thread, and which turns cost the most.

Run:

```
optiflow report $ARGUMENTS
```

If no arguments are given, this defaults to the current project's
transcripts (best-effort — derived from the directory Claude Code was
launched from) in `table` format over all history. Useful variations:

- `optiflow report --session <id>` — analyze one specific session by id, regardless of which project it's filed under (the most reliable lookup — see `src/transcript/discover.ts` for why current-project discovery is best-effort).
- `optiflow report --all --format markdown` — analyze every local project's transcripts and produce a table suitable for pasting into a PR/doc.
- `optiflow report --range 7d` — only include turns from the last 7 days.
- `optiflow report --format json` — machine-readable output.

If the command reports "no transcript files found," suggest `--session
<id>` or `--all` rather than assuming something is broken — this is a
normal outcome when the CLI's current working directory doesn't match the
directory Claude Code was originally launched from (see the tool's own
`--help` and `docs/modules.md` for the exact caveat).
