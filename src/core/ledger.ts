// Append-only before/after token-savings ledger: ~/.optiflow/ledger.jsonl
// (JSONL, not SQLite, per plan). Consumed later by the statusline/report
// modules. Writes never throw; reads skip unparseable lines rather than
// throwing, so one corrupt line can't take down the whole ledger.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { getOptiflowHome } from "./paths.js";

export interface LedgerRecord {
  timestamp: string;
  module: string;
  command_or_context: string;
  /**
   * The Claude Code session that produced this row, when the writer had one
   * (hooks do; the chop CLI wrapper does not). What makes test pollution
   * findable and per-session reporting possible -- rows written before this
   * field existed simply lack it.
   */
  session_id?: string;
  tokensBefore: number;
  tokensAfter: number;
  bytesBefore: number;
  bytesAfter: number;
}

export type LedgerRecordInput = Omit<LedgerRecord, "timestamp"> & {
  timestamp?: string;
};

export interface LedgerOptions {
  /** Override the ledger's home directory (defaults to getOptiflowHome()). */
  home?: string;
}

function ledgerPath(home: string): string {
  return path.join(home, "ledger.jsonl");
}

/**
 * Rotate once the ledger passes this size. Append-only JSONL with no pruning
 * meant unbounded growth and an ever-slower full-file `readLedger` scan; one
 * archived generation (`ledger.jsonl.1`, overwritten on the next rotation)
 * keeps recent history cheap without silently deleting everything.
 */
const ROTATE_AT_BYTES = 5 * 1024 * 1024;

function rotateIfOversized(file: string): void {
  try {
    const { size } = statSync(file);
    if (size < ROTATE_AT_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch {
    // Missing file (first write) or a race with another writer -- either
    // way the append below proceeds against whatever exists.
  }
}

/** Appends one record to the ledger. Never throws. */
export function appendLedger(
  record: LedgerRecordInput,
  options: LedgerOptions = {}
): void {
  try {
    const home = options.home ?? getOptiflowHome();
    mkdirSync(home, { recursive: true });
    rotateIfOversized(ledgerPath(home));
    const full: LedgerRecord = {
      timestamp: record.timestamp ?? new Date().toISOString(),
      module: record.module,
      command_or_context: record.command_or_context,
      ...(record.session_id ? { session_id: record.session_id } : {}),
      tokensBefore: record.tokensBefore,
      tokensAfter: record.tokensAfter,
      bytesBefore: record.bytesBefore,
      bytesAfter: record.bytesAfter,
    };
    appendFileSync(ledgerPath(home), JSON.stringify(full) + "\n", "utf8");
  } catch {
    // Ledger writes must never break the calling hook/CLI.
  }
}

/**
 * Reads back the ledger, optionally filtered to records at or after `since`.
 * Skips lines that fail to parse (or don't look like a ledger record)
 * instead of throwing, so a partially-corrupted file still yields whatever
 * is readable.
 */
export function readLedger(
  since?: string | Date,
  options: LedgerOptions = {}
): LedgerRecord[] {
  try {
    const home = options.home ?? getOptiflowHome();
    const file = ledgerPath(home);
    if (!existsSync(file)) return [];

    const sinceTime = since ? new Date(since).getTime() : -Infinity;
    const raw = readFileSync(file, "utf8");
    const out: LedgerRecord[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          typeof parsed.timestamp !== "string"
        ) {
          continue;
        }
        const parsedTime = new Date(parsed.timestamp).getTime();
        if (Number.isNaN(parsedTime) || parsedTime < sinceTime) continue;
        out.push(parsed as LedgerRecord);
      } catch {
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}
