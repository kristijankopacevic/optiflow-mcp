// P4: getting knowledge to the model for less than it saves — just-in-time
// finding injection on touch, cross-project lessons, and the zero-turn
// refusal (a diff or annotated skeleton carried inside a deny instead of a
// bare redirect).
//
// CHECKPOINT-2 STUB. Vendor's `inject.mjs`
// (`vendor/token-optimizer-mcp/plugin/hooks/lib/inject.mjs`, MIT-licensed
// — see THIRD_PARTY_LICENSES.md, 1194 lines) is genuinely core — its
// output changes both `additionalContext` on the allow path and the deny
// reason on the refusal path — but every one of vendor's own call sites
// wraps it in a try/catch that falls back to "no extra context" /
// "the plain redirect" on any failure (see `pretooluse-router.mjs`:
// "Delivery is an optimization. A defect here must never cost the user
// their tool call" / "Any failure here falls back to the plain redirect,
// which always works"). Stubbing every export here to that same fallback
// is therefore a faithful subset of vendor's own documented fail-open
// behavior for checkpoint 1's deny/redirect-only scope, not a new
// behavior — `pretooluse.ts` still denies/redirects exactly as vendor
// does; it just never carries a diff, a prior finding, or a cross-project
// lesson alongside that decision yet.
//
// Wiring the real logic in behind these exact signatures is checkpoint 2's
// task (needs `skeleton.ts`'s `annotatedSkeleton`, `utility.ts`'s
// `assessFindings`, and `staleness.ts`'s `serve`/`diffLines`, none of
// which are implemented yet either).

import type { Graph } from "./wiki.js";
import type { EpisodeMeta } from "./experiment.js";

export interface InjectOptions {
  sessionId?: string;
  alreadyInjected?: Set<string>;
  episode?: Partial<EpisodeMeta>;
}

/** No-op in this checkpoint — see module header. */
export function forTouch(_dir: string, _graph: Graph, _rawPath: string, _options: InjectOptions = {}): string | null {
  return null;
}

/** No-op in this checkpoint — see module header. */
export function forCommand(_dir: string, _graph: Graph, _command: string, _options: InjectOptions = {}): string | null {
  return null;
}

/** No-op in this checkpoint — see module header. */
export function forSharedCommand(
  _projectDir: string,
  _command: string,
  _options: InjectOptions & { projectRoot?: string | null } = {}
): string | null {
  return null;
}

/**
 * Records that this session performed an act of a given class. Returns an
 * empty set (never "crossed the repeat threshold") in this checkpoint —
 * paired with `forRepeatedAct` always returning null below, so no call
 * site observes a behavior different from "this feature is off".
 */
export function noteActClasses(_state: { actCounts?: Record<string, number> }, _command: string): Set<string> {
  return new Set();
}

/** No-op in this checkpoint — see module header. */
export function forRepeatedAct(
  _projectDir: string,
  _command: string,
  _crossedClasses: Set<string> | null,
  _options: { sessionId?: string | null; projectRoot?: string | null; episode?: Partial<EpisodeMeta> } = {}
): string | null {
  return null;
}

/**
 * The zero-turn refusal payload (diff or "unchanged" note carried inside a
 * deny). Returns null in this checkpoint, which vendor's own router
 * already treats as "fall back to the plain redirect" — see module
 * header.
 */
export function refusalPayload(
  _graph: Graph,
  _rawPath: string,
  _options: { maxDiffLines?: number; seenThisSession?: boolean } = {}
): string | null {
  return null;
}

/**
 * The annotated-skeleton substitution sent instead of a re-read. Returns
 * null in this checkpoint (falls back to the plain redirect, same as
 * above).
 */
export function substitutionFor(
  _dir: string,
  _graph: Graph,
  _rawPath: string,
  _source: string,
  _options: { sessionId?: string; client?: string | null; clientVersion?: string | null; model?: string | null; modelVersion?: string | null } = {}
): string | null {
  return null;
}

/**
 * Co-occurrence edges (files worked on together) written at PreCompact.
 * No-op in this checkpoint — a pure enrichment write with no reader on the
 * decision path.
 */
export function linkCoOccurrence(_dir: string, _sessionId: string | null, _paths: string[], _options: { maxLinks?: number } = {}): number {
  return 0;
}
