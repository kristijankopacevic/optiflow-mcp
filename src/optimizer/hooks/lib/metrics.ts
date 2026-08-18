// Telemetry and the A/B holdout, deliberately narrowed for this fork.
//
// CORE-VS-PERIPHERAL FINDING (see this phase's report): every symbol here
// is called by `pretooluse.ts`/`inject.ts` purely to append an analytics
// record (`record()`) or to decide whether to *silently withhold* a real
// feature from a random slice of calls so vendor's own live A/B experiment
// has a control arm (`inHoldout()`). Tracing every call site in
// `inject.mjs` confirms `episode`/client/model fields only ever flow into
// `record(dir, { ...episode, ... })` — never into a branch that changes
// what is returned. That analytics/experiment subsystem is exactly what
// this phase's brief named as out of scope ("live experiment A/B
// analytics").
//
// DELIBERATE PRODUCT DECISION, not a bug: `inHoldout()` always returns
// `false` here. Vendor's holdout exists so upstream can compare a treated
// vs. withheld population across many installs; this fork has no such
// live experiment running, and withholding a real optimization from some
// fraction of THIS fork's own users for a study nobody is conducting would
// only make the product worse for them. `record()` still writes a real
// (but simplified) JSONL ledger — no dual-write to a separate
// `balance.jsonl`/`evidence.jsonl`, no report/bootstrap-interval machinery
// (`report`, `buildReport`, `bootstrapMeanInterval`, `armMetrics`,
// `pairedEffects` — vendor's evaluation-harness reporting layer, ~1000 of
// `metrics.mjs`'s 1781 lines, unreachable from the two hooks this tree
// ports and overlapping `src/optimizer/analytics/**`'s already-merged,
// do-not-touch ownership) — so a future `optiflow report
// --include-optimizer` has real per-anchor read events to join against,
// without this fork silently re-implementing vendor's own research
// telemetry pipeline.
//
// Faithfully ported from
// `vendor/token-optimizer-mcp/plugin/hooks/lib/metrics.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md) for `fingerprint()`
// (pure, no simplification) and `recordRead()`/`record()` (dual-write and
// report machinery dropped, per above). `substitutionBudget()`/
// `indexBudget()` — vendor's "earned budget" logic — are deferred; see
// `inject.ts`'s header for the fixed-budget fallback this fork uses
// instead.

import { appendFileSync, mkdirSync, chmodSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const metricsPath = (dir: string) => join(dir, "metrics.jsonl");

/**
 * Is this touch in the holdout arm? Always `false` — see module header.
 * Kept as a function (rather than inlining `false` at call sites) so a
 * future decision to run a real experiment is a one-line change here, not
 * a re-audit of every call site.
 */
export function inHoldout(_anchorKey: string, _now: number = Date.now()): boolean {
  return false;
}

/**
 * A cheap fingerprint of a file's current content: size and mtime, not a
 * content hash — this runs on the PreToolUse path before every tool call.
 */
export function fingerprint(path: string): string | null {
  try {
    const st = statSync(path);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `${idCounter.toString(36)}-${randomBytes(4).toString("hex")}`;
}

/**
 * Appends one analytics record. Never throws, never affects a decision —
 * see module header. Simplified from vendor: one ledger file, no
 * balance/evidence dual-write, no report machinery.
 */
export function record(dir: string, event: Record<string, unknown>): Record<string, unknown> | null {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Not POSIX, or not ours to chmod.
    }
    const id = event.id || nextId();
    const complete = {
      schemaVersion: (event.schemaVersion as number) || 2,
      id,
      ...event,
      at: event.at ?? Date.now(),
    };
    appendFileSync(metricsPath(dir), `${JSON.stringify(complete)}\n`);
    return complete;
  } catch {
    return null;
  }
}

/** Records what a read of an anchor actually cost — the only measurement `inHoldout` would have gated. */
export function recordRead(
  dir: string,
  { anchor, sessionId, bytes, fp = null }: { anchor?: string; sessionId?: string; bytes?: number; fp?: string | null }
): void {
  if (!anchor || !bytes) return;
  record(dir, { kind: "read", anchor, sessionId, tokens: Math.ceil(bytes / 4), fp });
}

const MAX_BYTES = Number(process.env.TOKEN_OPTIMIZER_METRICS_BYTES) || 2_000_000;

/** Read events for an anchor, tail-bounded — used by `inject.ts`'s fixed-budget substitution path. */
export function readMetrics(dir: string): Array<Record<string, unknown>> {
  const path = metricsPath(dir);
  if (!existsSync(path)) return [];
  let text: string;
  try {
    const { size } = statSync(path);
    text = size <= MAX_BYTES ? readFileSync(path, "utf8") : "";
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A truncated final line is normal; skip it.
    }
  }
  return out;
}
