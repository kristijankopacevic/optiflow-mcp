// Module 3: statusline I/O helpers. Everything in this file does real
// filesystem I/O and is called ONLY from `cli.ts` (the thin wrapper) —
// never from `render.ts`/`segments.ts`, which must stay pure. Kept in its
// own module specifically so that boundary is enforced by import graph,
// not just by convention.
//
// Deliberately does NOT import `src/config/load.ts`: that module pulls in
// `zod` (via `src/config/schema.ts`), which is unnecessary weight on a
// path with a <100ms budget, and it would strip the `segments`/`meterWidth`
// /`activityStaleMs` keys anyway since `OptiflowConfigSchema`'s
// `StatuslineSchema` (src/config/schema.ts, owned by an earlier phase, out
// of scope here) only validates `enabled`/`debounceMs` today. Instead,
// `readStatuslineConfig` below duplicates `load.ts`'s layering (defaults ->
// user-global `~/.optiflow/config.json` -> project `optiflow.config.json`,
// project wins) for just the `statusline` section, reading raw JSON with
// defensive per-field type checks instead of zod validation. See
// docs/modules.md for the note about eventually folding these keys into
// the real schema.
//
// Reuses `src/core/paths.ts` (`getOptiflowHome`/`findProjectRoot`) and
// `src/core/hook-io.ts` (`readHookInput`, used by `cli.ts` for stdin) —
// both are already zero-dependency-beyond-node-builtins, per their own
// module headers, so reusing them costs nothing on the hot path.

import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { findProjectRoot, getOptiflowHome } from "../core/paths.js";
import {
  ALL_SEGMENTS,
  type ActivityBeacon,
  type RecentSavings,
  type SegmentName,
  type StatuslineRenderConfig,
} from "./render.js";

/**
 * Bounded read window for the ledger tail. NOT a full-file parse: the
 * ledger (`~/.optiflow/ledger.jsonl`) is append-only across every session
 * ever run, and on a long-lived machine it can grow arbitrarily large.
 * Reading only the last 8KB via a single positioned `readSync` (rather than
 * `readFileSync`'ing the whole file, which `src/core/ledger.ts`'s
 * `readLedger` does — fine for its own non-hot-path callers, wrong here)
 * keeps this segment's cost roughly constant regardless of ledger size.
 */
const LEDGER_TAIL_BYTES = 8192;

/**
 * How far back "recent savings" looks. Chosen because an 8KB tail window is
 * a BYTE window, not a session window — `LedgerRecord` carries no session
 * id (see src/core/ledger.ts), and the ledger spans every session ever run,
 * so without a time cutoff a quiet multi-day-old ledger tail could still
 * report stale numbers as if they were current. 6 hours is a rough proxy
 * for "this working session" without claiming session-scoping it can't
 * prove; `segments.ts`'s `savingsSegment` labels the output "(recent)", not
 * "(this session)", for the same reason.
 */
const RECENT_SAVINGS_WINDOW_MS = 6 * 60 * 60 * 1000;

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isSegmentName(value: unknown): value is SegmentName {
  return typeof value === "string" && (ALL_SEGMENTS as readonly string[]).includes(value);
}

function coerceStatuslineSection(raw: unknown): Partial<StatuslineRenderConfig> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<StatuslineRenderConfig> = {};

  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (Array.isArray(r.segments) && r.segments.length > 0 && r.segments.every(isSegmentName)) {
    out.segments = r.segments as SegmentName[];
  }
  if (typeof r.meterWidth === "number" && Number.isFinite(r.meterWidth) && r.meterWidth > 0) {
    out.meterWidth = r.meterWidth;
  }
  if (typeof r.activityStaleMs === "number" && Number.isFinite(r.activityStaleMs) && r.activityStaleMs >= 0) {
    out.activityStaleMs = r.activityStaleMs;
  }

  return out;
}

export interface StatuslineIoOptions {
  /** Override for the user-global `~/.optiflow` directory (tests only; falls back to `OPTIFLOW_HOME`/`getOptiflowHome()`). */
  home?: string;
  /** Directory to start the project-root search from (tests only; defaults to cwd). */
  cwd?: string;
  /** Override "now" for staleness/recency windows (tests only; defaults to `Date.now()`). */
  now?: number;
}

/**
 * Reads `statusline.*` config, layered defaults -> user-global -> project
 * (project wins, same precedence as `src/config/load.ts`), without zod.
 * Never throws: any read/parse failure at any layer contributes nothing for
 * that layer, and a missing config file anywhere is a normal, silent case
 * (not an error) — most projects will have no `optiflow.config.json` at
 * all.
 */
export function readStatuslineConfig(options: StatuslineIoOptions = {}): Partial<StatuslineRenderConfig> {
  try {
    const home = options.home ?? getOptiflowHome();
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = findProjectRoot(cwd);

    const userGlobal = readJsonObject(path.join(home, "config.json"));
    const project = readJsonObject(path.join(projectRoot, "optiflow.config.json"));

    return {
      ...coerceStatuslineSection(userGlobal?.statusline),
      ...coerceStatuslineSection(project?.statusline),
    };
  } catch {
    return {};
  }
}

/**
 * Reads the activity-beacon file, if present. Contract (also documented in
 * docs/modules.md — Phase 7's handoff module is specced to PRODUCE this
 * file; this phase only defines and consumes the contract):
 *   path: `~/.optiflow/activity.json`
 *   shape: `{ "tool": string, "timestamp": number }` (timestamp = epoch ms)
 * Never throws: a missing/malformed/empty file all resolve to `null`, which
 * `activitySegment` renders as nothing. Staleness itself is judged by
 * `activitySegment` from the in-file `timestamp` (not this file's mtime),
 * since this function already has the parsed value in hand.
 */
export function readActivityBeacon(options: StatuslineIoOptions = {}): ActivityBeacon | null {
  try {
    const home = options.home ?? getOptiflowHome();
    const file = path.join(home, "activity.json");
    if (!existsSync(file)) return null;

    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;

    const tool = typeof (parsed as Record<string, unknown>).tool === "string"
      ? ((parsed as Record<string, unknown>).tool as string)
      : null;
    const timestamp = typeof (parsed as Record<string, unknown>).timestamp === "number"
      ? ((parsed as Record<string, unknown>).timestamp as number)
      : null;

    if (!tool || timestamp === null) return null;
    return { tool, timestamp };
  } catch {
    return null;
  }
}

/**
 * Bounded, cheap read of the ledger's tail for a rough "recent savings"
 * figure. Mechanics: `openSync` -> `fstatSync` for size -> a single
 * `readSync` of `min(size, LEDGER_TAIL_BYTES)` positioned at
 * `max(0, size - LEDGER_TAIL_BYTES)` -> `closeSync`. This is O(1) in
 * ledger size, unlike `src/core/ledger.ts`'s `readLedger` (a full
 * `readFileSync` + line-by-line parse), which is fine for that module's own
 * non-hot-path callers but wrong for this <100ms path.
 *
 * The first line of the read window is discarded ONLY when the window
 * actually started mid-file (byte offset > 0, i.e. the ledger is larger
 * than `LEDGER_TAIL_BYTES`): that line is very likely a partial record
 * split at an arbitrary byte offset (including possibly mid-multi-byte-
 * UTF-8-character), and dropping it is simpler and safer than trying to
 * detect/repair it — at most one record out of what's usually many. When
 * the whole file fits in the window (offset 0, the common case for a
 * fresh or lightly-used ledger), the first line is a real, complete record
 * and is kept — unconditionally dropping it in that case would silently
 * under-report on exactly the small ledgers this feature most needs to
 * work correctly on.
 *
 * Records outside `RECENT_SAVINGS_WINDOW_MS` (see const above) are skipped
 * even if they're inside the byte window. Per record, this sums
 * `max(0, tokensBefore - tokensAfter)` — never `tokensBefore - tokensAfter`
 * unclamped — so a record where a transform inflated size (TOON can be
 * larger than JSON on non-uniform data; see plan Module 5) can't subtract
 * from the running total.
 *
 * Returns `null` (never throws) if the ledger doesn't exist, is empty, is
 * unreadable, or has no records inside the recency window.
 */
export function readRecentSavings(options: StatuslineIoOptions = {}): RecentSavings | null {
  try {
    const home = options.home ?? getOptiflowHome();
    const now = options.now ?? Date.now();
    const file = path.join(home, "ledger.jsonl");
    if (!existsSync(file)) return null;

    let raw: string;
    let position: number;
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      if (size === 0) return null;

      const length = Math.min(size, LEDGER_TAIL_BYTES);
      position = Math.max(0, size - LEDGER_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      const bytesRead = readSync(fd, buffer, 0, length, position);
      raw = buffer.toString("utf8", 0, bytesRead);
    } finally {
      closeSync(fd);
    }

    const lines = raw.split("\n");
    if (position > 0) {
      // Only discard the first line when the window actually started
      // mid-file (position > 0) — that line is very likely a partial
      // record split at an arbitrary byte offset. When the ledger is
      // smaller than the window (position === 0, the common case), `raw`
      // IS the whole file and its first line is a real, complete record —
      // dropping it there would silently under-report on every small
      // ledger, which is exactly the case this feature most needs to work.
      lines.shift();
    }

    const cutoff = now - RECENT_SAVINGS_WINDOW_MS;
    let tokensSaved = 0;
    let recordCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as Record<string, unknown>;
        if (!record || typeof record !== "object") continue;

        const timestamp = typeof record.timestamp === "string" ? new Date(record.timestamp).getTime() : NaN;
        if (Number.isNaN(timestamp) || timestamp < cutoff) continue;

        const before = typeof record.tokensBefore === "number" ? record.tokensBefore : NaN;
        const after = typeof record.tokensAfter === "number" ? record.tokensAfter : NaN;
        if (Number.isNaN(before) || Number.isNaN(after)) continue;

        tokensSaved += Math.max(0, before - after);
        recordCount += 1;
      } catch {
        continue;
      }
    }

    if (recordCount === 0) return null;
    return { tokensSaved, recordCount };
  } catch {
    return null;
  }
}
