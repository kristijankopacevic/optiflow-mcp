// Module 4: producing the "activity beacon" Phase 4's statusline already
// defined and consumes.
//
// CONTRACT (confirmed from `src/statusline/render.ts`'s `ActivityBeacon`
// type and `src/statusline/io.ts`'s `readActivityBeacon` — re-checked here
// rather than assumed, per this phase's brief):
//   path:  `~/.optiflow/activity.json` (i.e. `getOptiflowHome()/activity.json`)
//   shape: `{ "tool": string, "timestamp": number }` (timestamp = epoch ms)
// `src/handoff/activity.test.ts` proves this end-to-end by writing a beacon
// with THIS module and reading it back with Phase 4's actual
// `readActivityBeacon` (imported, not reimplemented).
//
// WHERE THIS GETS INVOKED FROM: a new, dedicated, lightweight `PreToolUse`
// hook (`src/handoff/activity-hook.ts` -> `plugin/hooks/pretooluse-activity.mjs`),
// registered in `plugin/hooks/hooks.json` alongside — not instead of —
// Phase 3's `Bash`-only chop entry. It does NOT piggyback on
// `src/chop/pretooluse.ts`: that hook fires only for `Bash` (by design — see
// its own module header), but the activity beacon is documented (plan
// Module 3, `segments.ts`'s "current tool/agent activity") to reflect
// activity across ALL tools, not just Bash. Two same-event hooks firing in
// parallel on the same event is safe here specifically because of the
// OUTPUT CONTRACT, not the event: this hook only ever emits a bare `{}` (see
// `activity-hook.ts`) — never `permissionDecision`/`updatedInput` — so it
// cannot collide with chop's rewrite even when both fire on the same `Bash`
// call. This mirrors `src/chop/pretooluse.ts`'s own documented reasoning for
// why its no-op path is a bare `{}` rather than `allow()`.
//
// Deliberately does NOT import `src/config/load.ts` (no zod) and never
// throws — mirrors `src/core/logger.ts`'s "logging/bookkeeping must never
// break the caller" contract. A dropped beacon write just means the
// statusline's `activity` segment renders nothing next tick, which is
// already a case `segments.ts` handles.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getOptiflowHome } from "../core/paths.js";

export interface ActivityBeaconRecord {
  tool: string;
  timestamp: number;
}

export interface WriteActivityBeaconOptions {
  /** Override for `~/.optiflow` (tests only; falls back to `OPTIFLOW_HOME`/`getOptiflowHome()`). */
  home?: string;
}

/**
 * Writes the activity beacon Phase 4's statusline reads. Never throws: any
 * failure (unwritable home dir, etc.) is swallowed, matching every other
 * fire-and-forget bookkeeping write in this codebase (`logger.ts`).
 */
export function writeActivityBeacon(
  record: ActivityBeaconRecord,
  options: WriteActivityBeaconOptions = {}
): void {
  try {
    const home = options.home ?? getOptiflowHome();
    mkdirSync(home, { recursive: true });
    const file = path.join(home, "activity.json");
    writeFileSync(file, JSON.stringify(record), "utf8");
  } catch {
    // Beacon writes must never break the calling hook.
  }
}
