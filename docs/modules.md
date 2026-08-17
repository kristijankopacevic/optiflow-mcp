# optiflow's five modules

This file is a per-module reference, appended to by each phase as its module
lands (see the build-order table in the plan). It documents contracts
between modules/phases — especially ones a *later* phase implements against
but doesn't yet exist — so nobody has to re-derive them from source later.

## Module 2 — session-report transcript analytics (`src/transcript/**`, `optiflow report`)

Parses Claude Code's own local transcript files
(`~/.claude/projects/<slug>/<sessionId>.jsonl`, NDJSON) directly. This is a
**disjoint data source** from token-optimizer-mcp's own analytics DB (which
only records what its own `smart_*` tools saved) — this module reads the
client-side conversation transcripts Claude Code itself writes, a different
vantage point (prompt/cache economics vs. tool-savings accounting).
`--include-optimizer`/`report.includeOptimizer` is meant to join the two by
`sessionId`; see "include-optimizer" below for why this phase reports it as
unavailable rather than implementing the join.

### Directory-naming convention (confirmed against real data on this machine)

`~/.claude/projects/<slug>/` — `<slug>` is the session's **launch**
directory (not its `cwd` at any given moment — `cwd` changes line-to-line as
the user/agent `cd`s around, but every line in one session's `.jsonl` lives
under one slug directory matching the launch directory), sanitized by
replacing every `:`/`\`/`/` character with `-` **individually** (adjacent
separators are NOT collapsed — `slugifyPath` uses `/[\\/:]/g`, not
`/[\\/:]+/g`). Verified exactly: `"C:\Users\Kristijan"` sanitizes to
`"C--Users-Kristijan"` (two hyphens, from the adjacent `:` and `\`), and a
real session's own transcript (found by grepping its `cwd` field) was
located filed under exactly that directory on this machine. `.`/`_`/space
handling is unverified (no local sample path contains them) and
intentionally not extrapolated beyond this narrow, confirmed rule.

Each `<sessionId>.jsonl` file has a same-named sibling directory
(`<slug>/<sessionId>/`) holding unrelated artifacts (e.g. `tool-results/`),
confirmed empirically — `discover.ts` only globs `*.jsonl` directly inside a
slug directory, never recursing into those.

Consequently `discoverCurrentProjectFiles` (which only has the CLI's own
`process.cwd()` to go on, not whatever directory Claude Code was actually
launched from) is a **best-effort approximation** — it can legitimately find
nothing even when transcripts for "this project" exist. `--session <id>`
(`discoverBySessionId`, slug-independent — globs
`~/.claude/projects/*/<sessionId>.jsonl`) is the reliable lookup and is what
this phase's own real-data verification run uses.

### Real schema, confirmed against actual local transcript files (not guessed from secondhand description)

- A line's top-level `type` is NOT limited to `user`/`assistant`/`tool_result`
  — real files also contain `queue-operation`, `attachment`,
  `file-history-snapshot`, `ai-title`, and others carrying no `message.usage`
  at all. `parse.ts`'s `TranscriptRecord` keeps `type` as a plain `string`
  and never assumes a line has a `message`.
- **A single assistant message can span multiple transcript lines** — one
  per content block (thinking/text/tool_use each got their own line in real
  samples) — every line sharing the same `message.id` AND an
  identical `usage` object. Verified on a real local session: 89
  `"type":"assistant"` lines carried only 40 distinct `message.id` values,
  every duplicate group's `usage` byte-identical. Summing `usage` per LINE
  inflates totals 2-3x; `analyze.ts` dedupes by `message.id` (falling back
  to the record's own `uuid`) before summing anything — this is the single
  most load-bearing correctness fix in this module.
- `usage.cache_creation` nests `{ephemeral_1h_input_tokens,
  ephemeral_5m_input_tokens}` — confirmed present alongside the top-level
  `cache_creation_input_tokens` (not reconciled against it; both are reported
  as-is).
- No real local transcript sampled (25,665 `isSidechain` lines checked
  across every project on this machine) had `isSidechain: true` — subagent
  grouping is implemented per the documented contract but is **unverified
  against a real example**; see "Subagent rollup" below.

### Cache-break definition (the documented judgment call)

A naive reading of "cache_creation > 0 right after a turn that had
cache_read > 0" was tried first and **rejected** after checking it against
real data — that pattern is the NORMAL steady state of incremental prompt
caching (every turn reads the prior cached prefix AND writes a new
incremental delta), so it fires on nearly every turn. The rule actually
used (`analyze.ts`'s `detectCacheBreaks`): turn `cur` breaks the cache chain
relative to `prev` (same thread — see below) when

```
prev.cacheReadTokens + prev.cacheCreationTokens > 0        (prev had a reusable cache chain)
  AND cur.cacheCreationTokens > 0                          (cur had to write new cache content)
  AND cur.cacheReadTokens < 0.5 * (prev's cache total above) (cur reused less than half of it)
```

Verified against two real local transcripts: a session with a >24h gap
between turns (cache TTL expiry) correctly flags 2/2 transitions (both had
`cache_read_input_tokens: 0` despite a substantial prior cached prefix);
a normal continuous same-session sequence of 39 transitions flags 0. The
`0.5` ratio is a threshold, not a law of nature, and is called out in
`analyze.ts`'s comments specifically so a future reviewer can second-guess
it.

Cache breaks are computed **before** `--range` filtering is applied, over
each thread's full chronological sequence — filtering first would make the
range window's own first turn look like a false break (no visible
predecessor). "Each thread" means each **session's own main-thread chain**
(`main:<sessionId>`) plus each subagent root's own chain
(`subagent:<rootUuid>`) — NOT one global main-thread chain across every
session. A single global chain was this module's first implementation and
was WRONG for `--all`/multi-session analysis: sorting every session's turns
together by timestamp interleaves unrelated sessions, and a transition from
session A's last turn to session B's first turn satisfies the break rule
almost by construction (B's turn writes new cache with no relationship to
A's cached prefix). Confirmed empirically against this machine's real
`--all` output: the single-global-chain version reported 293 "breaks"
across 14 sessions, of which 140 (nearly half) had `prev`/`cur` from two
different sessions — pure interleaving artifacts. Grouping by `sessionId`
first (mirroring the subagent-root grouping) dropped that to 194 breaks,
all within their own session, re-verified with a script cross-checking
every break's `prev.sessionId === cur.sessionId`.

### Subagent rollup (best-effort — unverified against real data)

Sidechain (`isSidechain: true`) turns are grouped by walking each turn's
`parentUuid` chain up to the first non-sidechain ancestor (or a
`parentUuid` not present among the parsed records at all — the common case,
since the anchor is usually a `Task` tool_use record). That ancestor's
`uuid` (or the dangling `parentUuid` itself) is the group's `rootUuid`.
Because no real local transcript exhibited a subagent turn, this logic is
implemented faithfully to the documented `isSidechain`/`parentUuid`
contract but has not been eyeballed against a real subagent transcript —
flagged in `analyze.ts`'s comments as a limitation, not asserted as proven.

### `--include-optimizer` / `report.includeOptimizer`

Documented (plan) as joining token-optimizer-mcp's own analytics DB by
`sessionId`. That DB is SQLite (`better-sqlite3`), and this phase does not
add a new dependency without explicit approval. Passing the flag does
**not** silently no-op: `runReportCli` always appends an explicit stderr
note ("`--include-optimizer` requested but not available: ... no new
dependency added") so a user relying on it learns why nothing joined,
rather than assuming it quietly worked. This is a stated limitation, not a
completed feature.

### Design: pure analysis/render, I/O isolated at the edges

- `src/transcript/parse.ts` — streams a `.jsonl` file line-by-line via
  `readline`/`createReadStream` (never `JSON.parse`s a whole file as one
  string); malformed/non-object lines are skipped and logged via
  `src/core/logger.ts` (which itself never throws), not thrown. Also
  exports a pure, file-free `parseTranscriptText` for fixture-based tests.
- `src/transcript/discover.ts` — the only module besides `parse.ts` that
  touches `node:fs`; every function returns `[]` rather than throwing when
  a directory doesn't exist (fresh machine, no matching session, etc.).
- `src/transcript/analyze.ts` — pure `analyze(records, options) ->
  AnalysisResult`, no I/O. Computes per-session totals, cache breaks,
  subagent rollups, top-N costliest turns (`totalTokens = input +
  cache_creation + cache_read + output`), and the thinking/cache-tier
  breakdown.
- `src/transcript/render.ts` — pure `table`/`json`/`markdown` renderers,
  `AnalysisResult -> string`, zero I/O (mirrors `src/statusline/render.ts`'s
  precedent; also an esbuild entry point, see `esbuild.config.mjs`).
- `src/cli/commands/report.ts` — thin commander wiring
  (`registerReportCommand`) plus two directly-testable, I/O-light cores:
  `resolveReportFiles` (discovery-only) and `runReportCli` (parses an
  already-resolved file list, analyzes, renders — this is what the
  integration test exercises against `fixtures/transcripts/sample.jsonl`
  without ever touching `~/.claude`). `runReportCli` accumulates every
  file's parsed records with a plain `for` loop, deliberately NOT
  `allRecords.push(...records)` — spreading a large per-file array into a
  function call risks V8's argument-count `RangeError`, and `--all` across
  this machine's real transcripts concatenates tens of thousands of lines
  across ~57MB of files (one file alone ~25MB).

### `--range` parsing

`parseRangeFlag` (in `report.ts`) supports `Nd`, `Nh`, and `all` (also the
default when omitted). An unrecognized shape fails **open** (no filtering)
with a warning surfaced to stderr, consistent with optiflow's "never crash
a CLI over a malformed flag" posture elsewhere in the codebase.

## Module 2 file map

```
src/transcript/
├── parse.ts    — streaming JSONL parser; TranscriptRecord/TranscriptUsage/TranscriptMessage types
├── discover.ts — the only other fs-touching file: discoverCurrentProjectFiles/discoverBySessionId/discoverAllProjectFiles, slugifyPath
├── analyze.ts  — pure analyze(records, options) -> AnalysisResult; cache-break/subagent-rollup/top-N logic
├── render.ts   — pure table/json/markdown renderers, zero I/O
├── *.test.ts
src/cli/commands/
├── report.ts      — registerReportCommand, resolveReportFiles, runReportCli, parseRangeFlag
├── report.test.ts
fixtures/transcripts/
└── sample.jsonl — hand-constructed (not copied from real personal data): normal turns, a duplicate-line-per-message.id case, a sidechain/subagent chain, a real cache-break sequence, and malformed lines
```

## Module 3 — Statusline context meter (`src/statusline/**`)

### Hard constraint

Claude Code debounces statusline updates at ~300ms (`statusline.debounceMs`
in optiflow's own config mirrors this, informationally) and **cancels — never
queues — an in-flight statusline script when a new trigger fires**. A slow
script doesn't render late; it doesn't render at all. `render()` itself
(see below) is therefore a zero-I/O pure function, and the only filesystem
reads on this path are small and bounded.

### Design: pure core, thin I/O wrapper

- `src/statusline/render.ts` — `render(input: StatuslineInput, ctx?: RenderContext): string`. Zero imports beyond `segments.ts` (type-only-adjacent); no `node:fs`, no heavy deps. `StatuslineInput` models **only** the real Claude Code statusline stdin schema (every field optional/nullable): `model.{id,display_name}`, `cwd`, `workspace.{current_dir,project_dir}`, `cost.total_cost_usd`, `context_window.{used_percentage,remaining_percentage,context_window_size,total_input_tokens}`, `exceeds_200k_tokens`, `transcript_path`. optiflow-internal precomputed data (resolved config, the activity beacon, the recent-savings figure, an injectable "now") is passed separately via `RenderContext`, not mixed into `StatuslineInput` — this keeps the stdin-schema type an honest model of what Claude Code actually sends, and keeps `render()` provably I/O-free.
- `src/statusline/segments.ts` — one pure function per segment (`meterSegment`, `modelSegment`, `costSegment`, `activitySegment`, `savingsSegment`). Also import-free beyond types. `context_window.used_percentage` is clamped to `[0, 100]` before computing the bar's filled-cell count (an unclamped negative value would make `"█".repeat(negative)` throw); `null`/`undefined`/non-finite renders `--%`, never `NaN%`, and composes correctly with `exceeds_200k_tokens: true` (both can render at once).
- `src/statusline/io.ts` — the ONLY file in this module that touches `node:fs`. Called exclusively from `cli.ts`, never from `render.ts`/`segments.ts`. Three functions:
  - `readStatuslineConfig` — see "Config" below.
  - `readActivityBeacon` — see "Activity beacon contract" below.
  - `readRecentSavings` — bounded ledger read, see "Ledger read strategy" below.
- `src/statusline/cli.ts` — the thin process entry point (bundled to `plugin/scripts/statusline.mjs`). Reads stdin via `src/core/hook-io.ts`'s `readHookInput` (reused as-is — it's a generic "read everything, `JSON.parse` it" helper with zero extra imports, not hook-response-shaped despite its module name), calls the three `io.ts` readers, calls `render()`, writes the result to stdout.

### Ledger read strategy (cheap, bounded — not a full-file parse)

`src/core/ledger.ts`'s own `readLedger` does a full `readFileSync` + line-by-line
parse of `~/.optiflow/ledger.jsonl`. That's fine for its own (non-hot-path)
callers, but wrong for a path with a <100ms budget on a ledger that grows
across every session ever run. `io.ts`'s `readRecentSavings` instead:

1. `openSync` the file, `fstatSync` for its size, `readSync` **only the last
   8192 bytes** (`LEDGER_TAIL_BYTES`) at the appropriate offset, `closeSync`.
   Cost is O(1) in ledger size, not O(n).
2. Discards the first line of that window **only if the window started
   mid-file** (byte offset > 0) — that line is very likely a partial record
   split at an arbitrary byte offset. If the whole file fit inside the
   window (offset 0 — the common case for a fresh/lightly-used ledger), the
   first line is a real, complete record and is kept.
3. Only counts records whose `timestamp` falls within a **6-hour recency
   window** (`RECENT_SAVINGS_WINDOW_MS`), because `LedgerRecord` (see
   `src/core/ledger.ts`) carries no session id and the ledger spans every
   session ever run — an 8KB byte window is not a session window. The
   rendered segment is honestly labeled `(recent)`, not `(this session)`.
4. Sums `max(0, tokensBefore - tokensAfter)` per record, never the
   unclamped difference — a transform that *inflates* size (TOON can be
   larger than JSON on non-uniform data; see plan Module 5) must not
   subtract from the total.

### Activity beacon contract (`~/.optiflow/activity.json`)

Phase 7 (`src/handoff/**`, see "Module 4" below) produces this "activity
beacon" the statusline reads, via a dedicated `PreToolUse` hook
(`src/handoff/activity-hook.ts`). This phase (4) defined and *consumes* the
contract; Phase 7 is the one that actually *produces* the file.

- **Path**: `~/.optiflow/activity.json` (i.e. `path.join(getOptiflowHome(), "activity.json")`).
- **Shape**: `{ "tool": string, "timestamp": number }` — `timestamp` is epoch milliseconds.
- **Staleness**: judged against the in-file `timestamp` (not the file's mtime), compared to "now" at render time. Default threshold: 5000ms (`activityStaleMs`, see Config below). A future timestamp (clock skew) is treated as fresh, not stale.
- **Absence/staleness/malformed contract is a normal case, not an error**: `activitySegment` renders nothing (`""`) — it never throws and never renders a placeholder for "no activity."

### Config

`OptiflowConfigSchema` (`src/config/schema.ts`, owned by an earlier phase,
out of scope for this one) only validates `statusline.enabled` and
`statusline.debounceMs` today. This module needs three more knobs
(`segments`, `meterWidth`, `activityStaleMs`) that aren't in that schema yet.

Rather than extend `src/config/schema.ts` (out of scope) or import
`src/config/load.ts` (which pulls in `zod` — unnecessary weight on a
<100ms path, and it would silently strip these unvalidated keys anyway),
`io.ts`'s `readStatuslineConfig` duplicates `load.ts`'s layering (defaults
-> user-global `~/.optiflow/config.json` -> project
`optiflow.config.json`, project wins, merged per-key) for just the
`statusline` section, using raw `JSON.parse` + defensive per-field type
checks instead of zod validation. Recognized keys:

```json
{
  "statusline": {
    "enabled": true,
    "segments": ["meter", "model", "cost", "activity", "savings"],
    "meterWidth": 10,
    "activityStaleMs": 5000
  }
}
```

An invalid value for any key (wrong type, unknown segment name, etc.) is
silently ignored for that key — never thrown — and the built-in default is
used instead. `statusline.enabled` is honored the same way whether it comes
from this raw path or (in principle) from the real schema; a project that
also uses `statusline.debounceMs` from the real schema is unaffected, since
this module never reads or writes that key.

**Follow-up for a later phase**: fold `segments`/`meterWidth`/
`activityStaleMs` into `OptiflowConfigSchema`'s `StatuslineSchema`
(`src/config/schema.ts`) so they get real zod validation and a single
config-loading code path; `io.ts`'s raw reader can then be deleted in favor
of `loadConfig()`.

### Activating the statusline (manual setup required this phase)

**Finding (plan's open question U1)**: a Claude Code plugin **cannot** ship
a working `statusLine` setting via its own plugin manifest or a
plugin-shipped `settings.json`. Verified directly against the installed
Claude Code binary on this machine (`~/.local/share/claude/versions/*`):
searching the binary for `statusLine` shows it is read from exactly one
place — the merged user/project settings object (`Pa()?.statusLine` in the
minified source) — and every other place a plugin's `settings.json` is
referenced in that binary is about `enabledPlugins` entries or per-plugin
*options*, never about contributing a `statusLine` value. None of the
vendored `token-optimizer-mcp`/`headroom` submodules ship a `statusLine`
plugin feature either (checked their `plugin.json`/marketplace manifests —
no `statusLine` key exists in either).

Consequently, this phase does **not** ship a `plugin/settings.json` (it
would be inert) and does **not** write to the user's real
`~/.claude/settings.json` (that's explicitly Phase 8/`install.ts`'s job,
with backup/restore — see plan Risk: "`statusLine` is single-valued/global
in Claude Code settings"). See `docs/statusline-manual-setup.md` for the
exact snippet a user (or the future installer) needs to add by hand today.

### Perf, measured on this machine (Windows 11, Node from `.local/share/claude`) — gate is PARTIALLY met, see caveat

- In-process `render()`: ~0.0022ms/call (1000 calls in ~2.2ms) — see the perf smoke test in `src/statusline/render.test.ts`.
- In-process `runStatusline()` (stdin already parsed, plus the bounded config/activity/ledger reads): ~0.11ms average, ~0.82ms worst-of-200 observed.
- Full process-spawn end-to-end (`node plugin/scripts/statusline.mjs` via a fresh shell, 10 samples): average ~83ms, but **one sample measured ~179ms** — above the 300ms debounce window's failure threshold is not far off, and a spike anywhere close to 300ms is the actual failure mode for this module (the in-flight script gets cancelled and simply never renders that tick, per the plan's hard constraint). A bare `node -e "console.log(1)"` baseline, measured the identical way, averages ~69ms on this same machine with similar spread — meaning process-spawn/Node-startup overhead accounts for essentially all of the wall-clock time and its variance; this module's own logic (~0.1ms per the in-process numbers above) is not the source of the risk.
- **Honest framing of the plan's Phase 4 gate ("renders in a real session, measured <100ms")**: the logic this module controls is met by roughly three orders of magnitude of margin. The full spawn-to-stdout path is machine/OS-dependent and, on this specific dev machine, occasionally approaches the debounce window — this is a property of Node process startup on Windows, shared by any Node-based statusline script (including the unrelated one already configured in this machine's real `~/.claude/settings.json`), not something `render()`/`io.ts`/`cli.ts` can fix. Flagging this as a partially-met gate rather than silently rounding it up to "passes."

## Module 3 file map

```
src/statusline/
├── render.ts   — pure render(input, ctx) -> string; StatuslineInput, RenderContext, StatuslineRenderConfig types
├── segments.ts — pure per-segment functions (meter/model/cost/activity/savings)
├── io.ts       — the only fs-touching file: readStatuslineConfig, readActivityBeacon, readRecentSavings
├── cli.ts      — thin process entry point -> bundled to plugin/scripts/statusline.mjs
├── render.test.ts / segments.test.ts / io.test.ts / cli.test.ts
fixtures/statusline/
├── normal.json          — full realistic payload
├── null-percentage.json — context_window.used_percentage: null (pre-first-turn / post-/compact)
└── exceeds-200k.json    — exceeds_200k_tokens: true combined with a high used_percentage
```

## Module 4 — Session handoff (`src/handoff/**`, `/optiflow:checkpoint`/`/optiflow:restore`/`/optiflow:compact-continue`, `optiflow checkpoint`)

Checkpoints session state before it's lost to compaction/a session ending,
and renders it back for a fresh session to resume from.

### Naming caveat

The plugin namespace means the real commands are `/optiflow:checkpoint`,
`/optiflow:restore`, and `/optiflow:compact-continue` — there is **no** bare
`/checkpoint`/`/restore`/`/compact-continue`. A user who wants a bare
`/compact-continue` can add their own thin wrapper under
`~/.claude/commands/compact-continue.md` (a personal, user-global command
directory Claude Code reads regardless of any installed plugin) containing
something like:

```markdown
---
description: Checkpoint now, then render a resume-ready summary (wraps optiflow's plugin command).
---
Run the optiflow plugin's combined checkpoint+restore command for me:
/optiflow:compact-continue $ARGUMENTS
```

This phase deliberately does **not** write that file on the user's behalf —
writing into `~/.claude/commands/` unprompted is a different, more invasive
kind of install step than anything else this plugin does (compare: the
statusline module's Phase 4 also stopped short of writing to
`~/.claude/settings.json` itself, deferring that to Phase 8's installer with
backup/restore).

### Checkpoint shape and field provenance — being honest about what a hook can and can't supply

```ts
interface Checkpoint {
  sessionId: string;
  timestamp: number;
  cwd: string;
  gitBranch: string | null;
  gitHead: string | null;
  model: string | null;
  openFiles: string[];
  decisions: string[];
  nextSteps: string[];
  tokenOptimizerStateRef: { file: string; sessionId: string; exists: boolean };
}
```

A checkpoint is built by `src/handoff/checkpoint.ts`'s `buildCheckpoint`, from
either an auto-triggered hook payload (`PreCompact`/`SessionEnd`) or a manual
CLI/slash-command call. The two paths populate genuinely different subsets:

- **`sessionId`, `cwd`** — from the hook payload's real, documented fields
  (`session_id`/`cwd`, verified against the vendored token-optimizer-mcp's
  own `plugin/hooks/precompact-optimize.mjs`, which reads exactly these) when
  auto-triggered; from `process.cwd()`/a generated `manual-<timestamp>` id
  when manual.
- **`timestamp`** — always `Date.now()` at checkpoint time.
- **`gitBranch`, `gitHead`** — always auto-derived via real `git -C <cwd>
  rev-parse` calls (`getGitInfo`, using `src/chop/win-spawn.ts`'s
  cross-platform-safe `runCommand`, reused rather than reimplemented). `null`
  (never thrown) when git is absent, `cwd` isn't a repo, or the repo is a
  fresh `git init` with no commits yet (no HEAD to resolve).
- **`model`** — present only when a hook payload happens to carry a `model`
  field. **Not a documented `PreCompact`/`SessionEnd` field** — the vendored
  code only reads `model` defensively from unrelated payload shapes
  elsewhere. Treat as usually `null`; `normalizeModel` handles string/object/
  absent shapes without throwing either way.
- **`openFiles`, `decisions`, `nextSteps` — NEVER auto-derivable from a hook
  payload alone.** Claude Code does not hand a `PreCompact`/`SessionEnd` hook
  the model's open-file list or its reasoning/next-step summary — there is no
  field on either event's documented payload that carries that. The
  auto-hooks always write `[]` for all three. **Only the manual path**
  (`/optiflow:checkpoint [notes]` slash command, or `optiflow checkpoint
  [notes] --next-step ... --open-file ...` on the CLI) populates them, from
  user-supplied text. This is a real, load-bearing gap in what an automatic
  checkpoint can capture — not a bug to "fix" later without a new data
  source (e.g. asking the model itself, via a hook's `additionalContext`
  request, is a plausible future direction but out of this phase's scope).
- **`tokenOptimizerStateRef`** — see next section.

### The token-optimizer state reference — verified, not guessed

Per the plan's collision note (token-optimizer-mcp also registers its own
`PreCompact` hook, `plugin/hooks/precompact-optimize.mjs`; both may safely
co-register on the same event), this module's checkpoint stores a
**reference** to token-optimizer's own persisted session state, never a copy
of its content. That reference points at:

```
~/.token-optimizer/sessions.json.gz
```

— confirmed by reading the vendored source directly (not assumed):
`vendor/token-optimizer-mcp/src/server/index.ts` sets
`persistencePath: path.join(os.homedir(), '.token-optimizer', 'sessions.json')`,
and `vendor/token-optimizer-mcp/src/core/session-manager.ts`'s
`saveGzippedFile` is what actually gzips it to the `.gz` suffix on disk. That
same `SessionManager` keys sessions internally by `sessionId` (a
`Map<string, Session>`), which is why the reference also carries the
checkpoint's own `sessionId` as the lookup key. This is the MCP **server's**
own durable session store — deliberately distinct from the plugin hooks'
own ephemeral per-process state directory
(`vendor/token-optimizer-mcp/plugin/hooks/lib/policy.mjs`'s `stateRoot()`,
under `os.tmpdir()`), which was confirmed absent on this machine and would
be a reference to nothing.

`exists` is computed at checkpoint time (a plain `existsSync` check) so
`restore.ts` can render an honest "did resolve" / "did not exist at
checkpoint time" note rather than silently asserting resolvability it never
checked.

### Restore — capped by default, not unbounded

The plan's Phase 7 gate is literally "checkpoint→restore round-trips,
≤10,000 chars" — and the whole point of rendering a checkpoint back is
pasting/injecting it into a live Claude context, so `src/handoff/restore.ts`'s
`renderRestoreMarkdown` caps its output at **10,000 chars by default** (the
same number `src/core/hook-io.ts` enforces for hook stdout — chosen for
consistency, not because slash-command/CLI stdout is literally hook JSON).
Truncation (when triggered) slices the whole rendered document and appends a
marker in the exact same text format `toCappedJson` uses
(`...[truncated, N chars omitted]`) — one documented convention, not two —
but does **not** call `toCappedJson` itself: that function shrinks the
longest string field inside a JSON *value* and re-serializes, which doesn't
fit a plain markdown document (no JSON structure to walk). Every real call
site in this phase (`/optiflow:restore`, `/optiflow:compact-continue`,
`optiflow checkpoint --restore`) uses the capped default; `--full` (CLI) /
`{ capChars: false }` (API) opts out for a genuine full-fidelity dump.

A second function, `renderCappedRestoreOutput`, renders a checkpoint as a
real `HookOutput` JSON string via `toCappedJson` (reused as-is, since this
path *is* a JSON value) — for a future `SessionStart` hook that would inject
a checkpoint's markdown as `additionalContext` on session start. **Nothing in
this phase's hook wiring emits this today** (there is no `SessionStart`
hook registered in `plugin/hooks/hooks.json` yet — this phase's brief is
`PreCompact`/`SessionEnd` checkpoint-*writing*, not session-start
restore-*injection*). It's exported and tested here so that future hook has
an already-correct contract to call into.

### Pruning (`handoff.keep`) — ordered by in-file timestamp, never filename or mtime

`handoff.keep` (default `20`, Phase 7 addition to `OptiflowConfigSchema`,
additive per every prior phase's config precedent) is the number of newest
checkpoints `createCheckpoint` keeps per checkpoint directory; older ones are
deleted right after each write via `pruneCheckpoints`. `keep: 0` means
"unlimited, never prune" — the schema validates it with `.nonnegative()`,
not `.positive()`, deliberately: `src/config/load.ts` falls back to
`DEFAULT_CONFIG` for the **entire** config on any validation failure, so an
over-strict lower bound would turn one legitimate `keep: 0` into a total
config reset.

Ordering is by each checkpoint's **in-file `timestamp`** field, via the
shared `listCheckpointFiles` helper (`checkpoint.ts` — `restore.ts` imports
this rather than keeping a second, slightly different `readdirSync` loop of
its own). This is NOT the same as sorting by filename
(`checkpointId()`'s `<sanitized-sessionId>-<timestamp>` stem sorts
alphabetically by session id first, which is not chronological once two
different session ids are involved) and NOT the same as sorting by
filesystem mtime (a copy/touch/clone/checkout can perturb mtime independently
of when the checkpoint was actually taken). A `.json` file that doesn't
parse, isn't an object, or is missing `sessionId`/`timestamp` is invisible to
`listCheckpointFiles` and therefore **never deleted** by pruning — "ignore
forever" is the safe failure mode for a file this module can't understand,
not "delete anything unrecognized in the directory." A failed individual
delete (permissions, a concurrent process) is caught and skipped, never
thrown — same fire-and-forget-bookkeeping contract `src/core/logger.ts`
documents for its own writes.

**Known interaction to watch, not yet resolved by this phase**: with
`handoff.enabled: true` and the `SessionEnd` hook registered, *every* session
end writes an auto-checkpoint — even when its `decisions`/`nextSteps`/
`openFiles` are all empty (see the field-provenance note above). On a busy
project, that auto-noise can evict older **manual** checkpoints (the ones
that actually captured something worth resuming from) purely because
keep-newest-N doesn't distinguish "meaningful" from "empty." Keep-newest-N is
exactly what the plan specs for this phase, so this document is flagging the
interaction rather than inventing an unrequested pinning/priority scheme —
that's a follow-up decision for a future phase, informed by real usage.

### The activity beacon — a second, dedicated `PreToolUse` hook, not a piggyback

`src/handoff/activity.ts`'s `writeActivityBeacon` produces
`~/.optiflow/activity.json` in the exact shape Phase 4's statusline already
defined and reads (`{ tool: string, timestamp: number }`, epoch ms — see
"Activity beacon contract" above; proven by an integration test that writes
with this module and reads back with Phase 4's real `readActivityBeacon`,
not a shape-alike mock).

It's invoked from a **new, separate** `PreToolUse` hook
(`src/handoff/activity-hook.ts` → `plugin/hooks/pretooluse-activity.mjs`),
registered in `hooks.json` with a broad `".*"` matcher (the same wildcard
convention this repo's own `hooks.json` already uses for
`posttooluse-mcp.mjs`'s `"mcp__.*"` matcher) — **not** piggybacked onto
Phase 3's `pretooluse-chop.mjs`, which is registered on `Bash` only by
design. The activity beacon is documented (plan Module 3) to reflect
activity across **all** tools, not just Bash, so it needs its own broader
registration. Two same-event hooks firing in parallel on the same tool call
is safe here specifically because of this hook's **output contract**, not
the event: it only ever emits a bare `{}` (never `permissionDecision`/
`updatedInput`), so it cannot collide with chop's rewrite even on a shared
`Bash` invocation.

**Measured cost of the broad matcher** (this hook spawns a fresh `node`
process on *every* tool call, unlike the rare `PreCompact`/`SessionEnd`
hooks): the built `pretooluse-activity.mjs` bundles to **~4.3KB**, vs.
`precompact-handoff.mjs`/`sessionend-handoff.mjs` at ~547KB and
`pretooluse-chop.mjs` at ~545KB. The gap is deliberate — `activity.ts`/
`activity-hook.ts` import only `node:fs`/`node:path` and
`src/core/hook-io.ts`/`src/core/paths.ts` (themselves zero-dependency), never
`src/config/load.ts` (which pulls in `zod`) or anything from `src/chop/**` —
so the per-tool-call hot path carries none of the config/zod weight the rarer
hooks can afford. This mirrors `src/statusline/io.ts`'s own reason for
avoiding `load.ts` on its hot path (see Module 3 above): both modules
independently arrived at "don't pull zod onto a path that runs constantly."

### Hooks registered (`plugin/hooks/hooks.json`)

Added alongside — not replacing — Phase 3's existing `PreToolUse: Bash` and
`PostToolUse: mcp__.*` entries:

- `PreToolUse` (matcher `.*`) → `pretooluse-activity.mjs` — see above.
- `PreCompact` (no matcher — verified against
  `vendor/token-optimizer-mcp/plugin/hooks/hooks.json`'s own `PreCompact`
  entry, which also carries no `matcher` key) → `precompact-handoff.mjs`.
  Always fail-open: every failure mode resolves to a bare `{}`, matching the
  vendored `precompact-optimize.mjs`'s own stated "compaction must proceed
  no matter what" philosophy. On success, emits a `systemMessage` pointing
  the user at `/optiflow:restore`/`/optiflow:compact-continue`.
- `SessionEnd` (no matcher) → `sessionend-handoff.mjs`. Not present in the
  vendored token-optimizer-mcp's own `hooks.json` at all (it registers
  `SessionStart`/`PreToolUse`/`PreCompact`/`PostToolUse`/`Stop`, no
  `SessionEnd`) — no co-registration concern for this event. Always returns
  a bare `{}` (there's no user-visible surface left once a session is
  ending) — the checkpoint write is a pure side effect.

Both `handoff` hooks respect `handoff.enabled` (default `true`) — checked via
`loadConfig` before doing any work; when `false`, both resolve to a bare `{}`
without writing anything.

### CLI (`optiflow checkpoint`)

`optiflow checkpoint [notes] [--next-step <text>] [--open-file <path>]
[--session <id>] [--restore [id]] [--full] [--list]` — the scriptable,
non-slash-command entry point (usable outside a live Claude Code session,
e.g. for testing or ad-hoc use):

- **Write (default)**: saves a checkpoint; `notes` becomes its sole
  `decisions[]` entry.
- **`--restore [id]`**: renders the most recent checkpoint (or the one
  matching `id`, by exact id or bare session-id prefix) instead of writing
  one. Capped at 10,000 chars by default; `--full` opts out.
- **`--list`**: enumerates every checkpoint in the resolved directory,
  newest-first (same `timestamp` ordering as pruning), one line each —
  id / taken-at (ISO) / git branch / decision count. Takes precedence over
  `--restore`/`notes` if given together (listing is read-only and there's no
  sensible combination that wants both at once).

### Slash commands (`plugin/commands/*.md`)

- `/optiflow:checkpoint [notes]` — wraps `optiflow checkpoint "$ARGUMENTS"`.
- `/optiflow:restore [checkpoint-id]` — wraps `optiflow checkpoint --restore
  "$ARGUMENTS"`.
- `/optiflow:compact-continue [notes]` — the plan's named combined
  save-then-restore convenience command. Behavior: checkpoint now (step 1,
  same as `/optiflow:checkpoint`), then immediately render that checkpoint
  back (step 2, same as `/optiflow:restore` with no id — the just-written
  checkpoint is now the latest). **Does not itself trigger compaction** — it
  only prepares for one (or for a session ending) by making sure a
  checkpoint exists and showing the user what a fresh session would resume
  with; the command's own `.md` says this explicitly since users are likely
  to assume otherwise from the name.

## Module 4 file map

```
src/handoff/
├── checkpoint.ts        — buildCheckpoint, getGitInfo, resolveTokenOptimizerStateRef,
│                           checkpointId, resolveCheckpointDir, writeCheckpoint,
│                           listCheckpointFiles, pruneCheckpoints, createCheckpoint
├── restore.ts            — loadCheckpoint, findLatestCheckpoint, findCheckpointById,
│                           resolveCheckpoint, renderRestoreMarkdown (capped by default),
│                           renderCappedRestoreOutput (future SessionStart hook contract)
├── activity.ts           — writeActivityBeacon (produces ~/.optiflow/activity.json)
├── activity-hook.ts       — PreToolUse (".*") hook entry -> plugin/hooks/pretooluse-activity.mjs
├── precompact-hook.ts     — PreCompact hook entry -> plugin/hooks/precompact-handoff.mjs
├── sessionend-hook.ts     — SessionEnd hook entry -> plugin/hooks/sessionend-handoff.mjs
├── checkpoint.test.ts / restore.test.ts / activity.test.ts
├── precompact-hook.test.ts / sessionend-hook.test.ts / activity-hook.test.ts
└── hooks.fixtures.test.ts — golden-fixture + real spawnSync-against-built-.mjs tests
src/cli/commands/checkpoint.ts — optiflow checkpoint [notes] / --restore / --full / --list
plugin/commands/
├── checkpoint.md / restore.md / compact-continue.md
fixtures/hooks/
├── precompact-basic.json / sessionend-basic.json / pretooluse-activity-read.json
```
