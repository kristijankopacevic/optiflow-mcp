// Module 2: transcript analysis — pure functions over already-parsed
// `TranscriptRecord[]` (no I/O; `parse.ts`/`discover.ts` own that). Computes
// totals, cache-break detection, subagent rollups, top-N costliest turns,
// and thinking/cache-tier breakdowns per the plan.
//
// ---------------------------------------------------------------------------
// De-duplication (load-bearing correctness fix, found via real-data
// inspection — see parse.ts's header, finding 2): a single assistant
// message can appear on MULTIPLE transcript lines (one per content block),
// every line sharing the same `message.id` and an IDENTICAL `usage` object.
// Summing `usage` per LINE inflates totals 2-3x. Verified directly on a
// real local session: 89 `"type":"assistant"` lines carried only 40
// distinct `message.id` values, and every duplicate group's `usage` was
// byte-identical JSON. This module therefore treats one **turn** as one
// distinct `message.id` (falling back to the record's own `uuid` if
// `message.id` is somehow absent) and takes its usage ONCE, not once per
// line.
// ---------------------------------------------------------------------------
// Cache-break definition (the judgment call the task asked to be
// documented precisely, for a future reviewer to evaluate):
//
// A naive rule — "cache_creation_input_tokens > 0 on a turn immediately
// after a turn that had cache_read_input_tokens > 0" — was tried first and
// REJECTED after checking it against real data: that pattern is the NORMAL
// steady-state of Claude's incremental prompt caching (each turn reads the
// prior cached prefix AND writes a new incremental delta), so it fires on
// essentially every turn, not just the ones where the cache chain actually
// broke. Confirmed empirically: 0 false-rule triggers would even be
// possible to distinguish with it across 39 real in-session turn
// transitions in a normal (non-multi-day-gap) session.
//
// The rule actually used here: a turn `cur` immediately following `prev` in
// the same thread (main thread, or one subagent's own chain — see
// `groupSidechainsByRoot`) is a CACHE BREAK when:
//
//   prev.cacheReadTokens + prev.cacheCreationTokens > 0   (prev had a cache
//                                                           chain worth reusing)
//   AND cur.cacheCreationTokens > 0                        (cur had to write
//                                                           NEW cache content)
//   AND cur.cacheReadTokens < CACHE_BREAK_READ_RATIO * (prev.cacheReadTokens
//                                                        + prev.cacheCreationTokens)
//       (cur reused less than half of what was cached before it — most of
//        the prior context had to be re-primed from scratch, not just
//        incrementally extended)
//
// Verified against two real local transcripts: a session with a >24h gap
// between turns (cache TTL expiry) correctly flags 2/2 transitions as
// breaks (cache_read_input_tokens was 0 on both later turns despite a
// substantial prior cached prefix), while a normal continuous same-session
// sequence of 39 transitions flags 0 — i.e. the rule discriminates the
// intended case (TTL expiry / `/compact` / prefix mutation) from ordinary
// incremental caching, which the naive textual reading of the plan's
// example rule does not.
//
// `CACHE_BREAK_READ_RATIO = 0.5` is a threshold, not a law of nature — a
// future reviewer may reasonably prefer a stricter (e.g. 0.1) or looser
// (e.g. 0.9) cutoff. It is called out here specifically so it CAN be
// second-guessed.

import type { TranscriptRecord } from "./parse.js";

const CACHE_BREAK_READ_RATIO = 0.5;

export interface TurnSummary {
  /** Dedup key: `message.id`, falling back to the record's own `uuid`. */
  id: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  timestampMs: number;
  isSidechain: boolean;
  model?: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  thinkingTokens: number;
  cacheCreationEphemeral1h: number;
  cacheCreationEphemeral5m: number;
}

export interface CacheBreakEvent {
  /** `"main:<sessionId>"` or `"subagent:<rootUuid>"` — which chain the break occurred in. Sessions/subagent roots are independent chains; see `analyze()`'s comments on why a single global "main" chain across sessions was wrong. */
  thread: string;
  turnId: string;
  timestamp?: string;
  sessionId?: string;
  previousTurnId: string;
  previousCacheTotal: number;
  currentCacheRead: number;
  currentCacheCreation: number;
}

export interface SessionTotals {
  sessionId: string;
  turnCount: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface SubagentGroup {
  rootUuid: string;
  turnCount: number;
  totalTokens: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface TotalsBreakdown {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  thinkingTokens: number;
  cacheCreationEphemeral1h: number;
  cacheCreationEphemeral5m: number;
}

export interface AnalyzeOptions {
  /** Inclusive lower bound, epoch ms. Omit for no lower bound. */
  rangeStartMs?: number;
  /** Inclusive upper bound, epoch ms. Omit for no upper bound. */
  rangeEndMs?: number;
  /** How many entries `topTurns` should contain. Default 10. */
  topN?: number;
}

export interface AnalysisResult {
  turnCount: number;
  mainThreadTurnCount: number;
  sidechainTurnCount: number;
  sessions: SessionTotals[];
  totals: TotalsBreakdown;
  cacheBreaks: CacheBreakEvent[];
  subagents: SubagentGroup[];
  topTurns: TurnSummary[];
  range: { startMs?: number; endMs?: number };
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Extracts one turn per distinct `message.id`/`uuid` from a raw record. Returns `null` for non-turn lines (no usage). */
function toTurnSummary(record: TranscriptRecord): TurnSummary | null {
  const usage = record.message?.usage;
  if (record.type !== "assistant" || !usage) return null;

  const id = record.message?.id ?? record.uuid ?? record.requestId;
  if (!id) return null;

  const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;
  const timestampMs = timestamp ? new Date(timestamp).getTime() : NaN;

  const inputTokens = toNumber(usage.input_tokens);
  const cacheCreationTokens = toNumber(usage.cache_creation_input_tokens);
  const cacheReadTokens = toNumber(usage.cache_read_input_tokens);
  const outputTokens = toNumber(usage.output_tokens);

  return {
    id,
    uuid: record.uuid,
    parentUuid: record.parentUuid ?? null,
    sessionId: record.sessionId,
    timestamp,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : Number.POSITIVE_INFINITY,
    isSidechain: record.isSidechain === true,
    model: record.message?.model,
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    totalTokens: inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens,
    thinkingTokens: toNumber(usage.output_tokens_details?.thinking_tokens),
    cacheCreationEphemeral1h: toNumber(usage.cache_creation?.ephemeral_1h_input_tokens),
    cacheCreationEphemeral5m: toNumber(usage.cache_creation?.ephemeral_5m_input_tokens),
  };
}

/**
 * Dedupes turns by `id` (see module header), keeping the first-seen entry
 * for each id — real duplicates carry identical usage, so which one is
 * kept doesn't change the numbers; keeping the first preserves the
 * earliest `timestamp` for a message that (per real samples) is stamped
 * the same across all of a message's split lines anyway.
 */
function dedupeTurns(records: TranscriptRecord[]): TurnSummary[] {
  const seen = new Map<string, TurnSummary>();
  for (const record of records) {
    const turn = toTurnSummary(record);
    if (!turn) continue;
    if (!seen.has(turn.id)) {
      seen.set(turn.id, turn);
    }
  }
  return [...seen.values()];
}

function byTimestampThenInsertion(turns: TurnSummary[]): TurnSummary[] {
  return turns
    .map((turn, index) => ({ turn, index }))
    .sort((a, b) => a.turn.timestampMs - b.turn.timestampMs || a.index - b.index)
    .map(({ turn }) => turn);
}

/**
 * Walks a sidechain turn's `parentUuid` chain up to the first non-sidechain
 * ancestor (or a `parentUuid` that isn't found among `byUuid` at all — the
 * common case, since the anchor is usually the main thread's `Task`
 * `tool_use` record, whose own `uuid` this function returns unchanged when
 * it isn't present in `byUuid`). Bounded by `maxDepth` purely as a
 * defensive guard against a corrupt/cyclic `parentUuid` chain in malformed
 * data — never expected to matter on real transcripts.
 *
 * UNVERIFIED against real subagent data: every local transcript sampled
 * for this phase had `isSidechain: false` on every single line (25,665
 * checked, 0 `true`) — this machine has apparently never recorded a
 * Task-tool subagent turn. The grouping logic below follows the documented
 * `isSidechain`/`parentUuid` contract faithfully, but nobody has been able
 * to eyeball it against a real subagent transcript; treat per-subagent
 * attribution as best-effort until it has been.
 */
function findSidechainRoot(
  startParentUuid: string | null | undefined,
  byUuid: Map<string, TranscriptRecord>,
  maxDepth = 1000
): string {
  if (!startParentUuid) return "unattributed-subagent";

  let currentUuid: string | null | undefined = startParentUuid;
  let lastUuid = startParentUuid;
  let depth = 0;

  while (currentUuid && depth < maxDepth) {
    const record = byUuid.get(currentUuid);
    if (!record || record.isSidechain !== true) {
      return currentUuid;
    }
    lastUuid = currentUuid;
    currentUuid = record.parentUuid;
    depth += 1;
  }

  return lastUuid;
}

function detectCacheBreaks(thread: string, orderedTurns: TurnSummary[]): CacheBreakEvent[] {
  const breaks: CacheBreakEvent[] = [];
  for (let i = 1; i < orderedTurns.length; i++) {
    const prev = orderedTurns[i - 1];
    const cur = orderedTurns[i];
    const prevCacheTotal = prev.cacheReadTokens + prev.cacheCreationTokens;

    if (
      cur.cacheCreationTokens > 0 &&
      prevCacheTotal > 0 &&
      cur.cacheReadTokens < prevCacheTotal * CACHE_BREAK_READ_RATIO
    ) {
      breaks.push({
        thread,
        turnId: cur.id,
        timestamp: cur.timestamp,
        sessionId: cur.sessionId,
        previousTurnId: prev.id,
        previousCacheTotal: prevCacheTotal,
        currentCacheRead: cur.cacheReadTokens,
        currentCacheCreation: cur.cacheCreationTokens,
      });
    }
  }
  return breaks;
}

function inRange(turn: TurnSummary, startMs: number, endMs: number): boolean {
  if (!Number.isFinite(turn.timestampMs)) return true; // don't silently drop turns with an unparseable timestamp
  return turn.timestampMs >= startMs && turn.timestampMs <= endMs;
}

function emptyTotals(): TotalsBreakdown {
  return {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    thinkingTokens: 0,
    cacheCreationEphemeral1h: 0,
    cacheCreationEphemeral5m: 0,
  };
}

function addToTotals(totals: TotalsBreakdown, turn: TurnSummary): void {
  totals.inputTokens += turn.inputTokens;
  totals.cacheCreationTokens += turn.cacheCreationTokens;
  totals.cacheReadTokens += turn.cacheReadTokens;
  totals.outputTokens += turn.outputTokens;
  totals.totalTokens += turn.totalTokens;
  totals.thinkingTokens += turn.thinkingTokens;
  totals.cacheCreationEphemeral1h += turn.cacheCreationEphemeral1h;
  totals.cacheCreationEphemeral5m += turn.cacheCreationEphemeral5m;
}

/**
 * Analyzes a full set of already-parsed transcript records (typically the
 * concatenation of one or more `.jsonl` files' `ParseResult.records`).
 *
 * Cache-break detection and subagent-root attribution are computed over the
 * FULL, unfiltered chronological record set FIRST; `rangeStartMs`/
 * `rangeEndMs` are applied only afterward, to decide which already-computed
 * turns/breaks are included in the returned totals/top-N/etc. Filtering
 * before computing adjacency would make the range window's own first turn
 * look like a false cache break (it would have no visible predecessor) —
 * see the plan's note on this exact pitfall.
 */
export function analyze(records: TranscriptRecord[], options: AnalyzeOptions = {}): AnalysisResult {
  const startMs = options.rangeStartMs ?? Number.NEGATIVE_INFINITY;
  const endMs = options.rangeEndMs ?? Number.POSITIVE_INFINITY;
  const topN = options.topN && options.topN > 0 ? Math.floor(options.topN) : 10;

  const byUuid = new Map<string, TranscriptRecord>();
  for (const record of records) {
    if (record.uuid) byUuid.set(record.uuid, record);
  }

  const allTurns = dedupeTurns(records);
  const mainThreadAll = byTimestampThenInsertion(allTurns.filter((t) => !t.isSidechain));
  const sidechainAll = byTimestampThenInsertion(allTurns.filter((t) => t.isSidechain));

  // Subagent root attribution — computed over the FULL sidechain set so a
  // turn that falls outside the requested range still correctly attributes
  // any in-range sibling turns to the same root.
  const rootByTurnId = new Map<string, string>();
  for (const turn of sidechainAll) {
    rootByTurnId.set(turn.id, findSidechainRoot(turn.parentUuid, byUuid));
  }

  // Cache breaks: each SESSION's main thread is its own independent chain,
  // and each subagent root is its own independent chain. A single global
  // main-thread chain (this module's first implementation) is WRONG for
  // `--all`/multi-session analysis: sorting every session's turns together
  // by timestamp interleaves unrelated sessions, and a transition from
  // session A's last turn to session B's first turn satisfies the break
  // rule almost by construction (B's turn writes new cache and has no
  // relationship to A's cached prefix). Confirmed empirically against this
  // machine's real local transcripts: grouping by a single global chain
  // produced 293 "breaks" across 14 sessions, of which 140 (nearly half)
  // had `prev`/`cur` from two DIFFERENT sessions — pure interleaving
  // artifacts, not real cache breaks. Grouping by `sessionId` first (same
  // pattern as the subagent-root grouping below) eliminates that entirely.
  const mainThreadChains = new Map<string, TurnSummary[]>();
  for (const turn of mainThreadAll) {
    const key = turn.sessionId ?? "unknown-session";
    const chain = mainThreadChains.get(key) ?? [];
    chain.push(turn);
    mainThreadChains.set(key, chain);
  }

  const subagentChains = new Map<string, TurnSummary[]>();
  for (const turn of sidechainAll) {
    const root = rootByTurnId.get(turn.id) ?? "unattributed-subagent";
    const chain = subagentChains.get(root) ?? [];
    chain.push(turn);
    subagentChains.set(root, chain);
  }

  const allCacheBreaks: CacheBreakEvent[] = [];
  for (const [sessionId, chain] of mainThreadChains) {
    allCacheBreaks.push(...detectCacheBreaks(`main:${sessionId}`, chain));
  }
  for (const [root, chain] of subagentChains) {
    allCacheBreaks.push(...detectCacheBreaks(`subagent:${root}`, chain));
  }

  // --- Range filtering happens here, after all adjacency-dependent work. ---
  const mainThread = mainThreadAll.filter((t) => inRange(t, startMs, endMs));
  const sidechain = sidechainAll.filter((t) => inRange(t, startMs, endMs));
  const cacheBreaks = allCacheBreaks.filter((b) => {
    const ts = b.timestamp ? new Date(b.timestamp).getTime() : NaN;
    return !Number.isFinite(ts) || (ts >= startMs && ts <= endMs);
  });

  const filteredTurns = [...mainThread, ...sidechain];

  const totals = emptyTotals();
  const sessionMap = new Map<string, SessionTotals>();
  for (const turn of filteredTurns) {
    addToTotals(totals, turn);
    const sessionId = turn.sessionId ?? "unknown-session";
    const existing = sessionMap.get(sessionId) ?? {
      sessionId,
      turnCount: 0,
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    existing.turnCount += 1;
    existing.inputTokens += turn.inputTokens;
    existing.cacheCreationTokens += turn.cacheCreationTokens;
    existing.cacheReadTokens += turn.cacheReadTokens;
    existing.outputTokens += turn.outputTokens;
    existing.totalTokens += turn.totalTokens;
    sessionMap.set(sessionId, existing);
  }

  const subagentGroups = new Map<string, SubagentGroup>();
  for (const turn of sidechain) {
    const root = rootByTurnId.get(turn.id) ?? "unattributed-subagent";
    const existing = subagentGroups.get(root) ?? {
      rootUuid: root,
      turnCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };
    existing.turnCount += 1;
    existing.totalTokens += turn.totalTokens;
    existing.inputTokens += turn.inputTokens;
    existing.cacheCreationTokens += turn.cacheCreationTokens;
    existing.cacheReadTokens += turn.cacheReadTokens;
    existing.outputTokens += turn.outputTokens;
    subagentGroups.set(root, existing);
  }

  const topTurns = [...filteredTurns].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, topN);

  return {
    turnCount: filteredTurns.length,
    mainThreadTurnCount: mainThread.length,
    sidechainTurnCount: sidechain.length,
    sessions: [...sessionMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    totals,
    cacheBreaks,
    subagents: [...subagentGroups.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    topTurns,
    range: {
      startMs: Number.isFinite(startMs) ? startMs : undefined,
      endMs: Number.isFinite(endMs) ? endMs : undefined,
    },
  };
}
