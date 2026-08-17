// Module 3: statusline segment renderers. Every function here is pure and
// import-free beyond type-only imports from `render.ts` — no `node:fs`, no
// I/O of any kind. That's what makes the zero-deps/<100ms claim provable
// rather than asserted: this file (and `render.ts`, which composes it)
// literally cannot touch the filesystem or network. The functions that DO
// need data from the filesystem (`activity`, `savings`) take that data as
// an already-resolved parameter instead of fetching it — the fetching lives
// in `io.ts`, called only from the `cli.ts` entry point.

import type { ActivityBeacon, RecentSavings, StatuslineModelInfo } from "./render.js";

/**
 * A visual bar for `context_window.used_percentage`, e.g. `[███░░░░░░░] 34%`.
 *
 * `usedPercentage` is `null`/`undefined`/non-finite before the first API
 * call in a session and immediately after `/compact` (confirmed Claude Code
 * behavior) — renders an empty (`░`-only) bar with a `--%` marker in that
 * case, never `NaN%`. Any other out-of-range value (negative, >100) is
 * clamped to `[0, 100]` BEFORE computing the filled-cell count: an
 * unclamped negative percentage would make `"█".repeat(negative)` throw a
 * `RangeError` on the one path that most needs to never throw.
 * `exceedsLimit` (from `exceeds_200k_tokens`) is flagged with a trailing
 * warning marker regardless of whether the percentage itself is known.
 */
export function meterSegment(
  usedPercentage: number | null | undefined,
  exceedsLimit: boolean,
  width: number
): string {
  const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : 10;
  const flag = exceedsLimit ? " ⚠" : "";

  if (usedPercentage === null || usedPercentage === undefined || !Number.isFinite(usedPercentage)) {
    return `[${"░".repeat(w)}] --%${flag}`;
  }

  const clamped = Math.min(100, Math.max(0, usedPercentage));
  const filled = Math.min(w, Math.max(0, Math.round((clamped / 100) * w)));
  const bar = "█".repeat(filled) + "░".repeat(w - filled);
  return `[${bar}] ${Math.round(clamped)}%${flag}`;
}

/** `model.display_name`, falling back to `model.id`, falling back to a placeholder. */
export function modelSegment(model: StatuslineModelInfo | null | undefined): string {
  const name = model?.display_name || model?.id;
  return name ? String(name) : "unknown-model";
}

/**
 * `cost.total_cost_usd` formatted as currency. Renders nothing (not
 * `"$0.00"`) when the value is missing/null/non-finite — "unknown cost" and
 * "zero cost" are different facts and shouldn't look the same.
 */
export function costSegment(totalCostUsd: number | null | undefined): string {
  if (totalCostUsd === null || totalCostUsd === undefined || !Number.isFinite(totalCostUsd)) {
    return "";
  }
  return `$${totalCostUsd.toFixed(2)}`;
}

/**
 * Renders the current tool/agent activity beacon, or nothing if absent or
 * stale. Staleness is judged against the beacon's own `timestamp` field
 * (epoch ms), compared to `now` (both injectable — `io.ts` supplies the
 * real file read, `render.ts`/tests supply `now`). A `timestamp` in the
 * future (clock skew) is treated as fresh, not stale, rather than throwing
 * or misrendering.
 */
export function activitySegment(
  activity: ActivityBeacon | null | undefined,
  now: number,
  staleMs: number
): string {
  if (!activity) return "";
  const tool = activity.tool;
  if (typeof tool !== "string" || tool.length === 0) return "";

  const ts = activity.timestamp;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";

  const age = now - ts;
  if (age > staleMs) return "";

  return `⚙ ${tool}`;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Renders a rough "recent savings" figure from `io.ts`'s bounded ledger
 * read, or nothing if there's nothing to report. Labeled "(recent)", not
 * "(this session)" — see `io.ts`'s header for why a time-boxed window over
 * an append-only, session-agnostic ledger can't honestly claim to be
 * session-scoped.
 */
export function savingsSegment(savings: RecentSavings | null | undefined): string {
  if (!savings || !Number.isFinite(savings.tokensSaved) || savings.tokensSaved <= 0) {
    return "";
  }
  return `♻ ~${formatTokenCount(savings.tokensSaved)} tok saved (recent)`;
}
