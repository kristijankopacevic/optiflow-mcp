// Append-only before/after token-savings ledger: ~/.optiflow/ledger.jsonl
// (JSONL, not SQLite, per plan). Consumed later by the statusline/report
// modules. Writes never throw; reads skip unparseable lines rather than
// throwing, so one corrupt line can't take down the whole ledger.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getOptiflowHome } from "./paths.js";

export interface LedgerRecord {
  timestamp: string;
  module: string;
  command_or_context: string;
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

/** Appends one record to the ledger. Never throws. */
export function appendLedger(
  record: LedgerRecordInput,
  options: LedgerOptions = {}
): void {
  try {
    const home = options.home ?? getOptiflowHome();
    mkdirSync(home, { recursive: true });
    const full: LedgerRecord = {
      timestamp: record.timestamp ?? new Date().toISOString(),
      module: record.module,
      command_or_context: record.command_or_context,
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
