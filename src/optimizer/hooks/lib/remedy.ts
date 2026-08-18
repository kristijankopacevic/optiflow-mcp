// Applied fixes (skip/skeleton-only rules) that the PreToolUse decision
// consults before refusing a read.
//
// SCOPE NOTE: vendor's `remedy.mjs` (MIT-licensed — see
// THIRD_PARTY_LICENSES.md) is ~300 lines covering the full remedy lifecycle:
// `applyRemedy`/`revertRemedy`/`proposal`/`measureRemedy`/`remedyLedger`/
// `briefing`/`wasteReport`. Only `activeRules` is reachable from the two
// hooks this tree ports (`pretooluse-router.mjs`'s `decide.mjs` calls it to
// find a rule covering the file about to be read); the rest is written by,
// and consumed by, hook entry points this phase does not port
// (`session-start.mjs`'s briefing, a `doctor`/report CLI path) and is
// intentionally not implemented here — this is the applied-fix READ side
// only, never the side that writes a new rule.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RemedyRule {
  id: string;
  type: string;
  anchor?: string;
  anchors?: string[];
  why: string;
  detector?: string;
  appliedAt: number;
  baselinePerSession?: number;
  revertedAt?: number;
}

function rulesPath(dir: string): string {
  return join(dir, "rules.json");
}

/** Every rule in force. Never throws: a corrupt rules file must not break a hook. */
export function activeRules(dir: string): RemedyRule[] {
  try {
    const parsed = JSON.parse(readFileSync(rulesPath(dir), "utf8"));
    return Array.isArray(parsed?.rules) ? parsed.rules.filter((r: RemedyRule) => !r.revertedAt) : [];
  } catch {
    return [];
  }
}
