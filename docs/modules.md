# optiflow's five modules

This file is a per-module reference, appended to by each phase as its module
lands (see the build-order table in the plan). It documents contracts
between modules/phases — especially ones a *later* phase implements against
but doesn't yet exist — so nobody has to re-derive them from source later.

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

Phase 7 (`src/handoff/**`, not yet built as of this phase) is specced to
produce an "activity beacon" the statusline reads. This phase defines and
*consumes* the contract; Phase 7 is responsible for *producing* the file.

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
