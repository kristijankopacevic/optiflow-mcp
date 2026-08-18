// Node-side CCR (compress-cache-retrieve) store scaffold.
//
// Per the optiflow-mcp v2 plan's locked decision: "CCR storage moved to the
// Node/TS side ... instead of trying to get headroom's Rust storage
// backends into WASM." The WASM module (`native/headroom-wasm/`) computes
// `<<ccr:HASH ...>>` hashes/markers but is deliberately built WITHOUT a CCR
// store attached (see `native/headroom-wasm/src/lib.rs`'s doc comment on
// the `Instant::now()` hazard `InMemoryCcrStore` would otherwise trigger) —
// so nothing is stored on the Rust side today.
//
// This module is an independent, testable `hash -> original content`
// store, following `src/core/ledger.ts`'s JSONL-append-file pattern for
// consistency with the rest of the codebase (append-only, home-dir-based,
// never throws on write, degrades gracefully on read).
//
// NOT wired to `src/native/smart-crusher.ts`'s `compress()` yet — that
// integration (parsing the real `<<ccr:HASH>>` marker format out of
// SmartCrusher's output and using it as the key here) is explicitly out of
// scope for this phase; see the plan's "Explicitly NOT this phase's job"
// section. This module just needs to store and retrieve `hash -> content`
// pairs correctly in isolation.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getOptiflowHome } from "../core/paths.js";

export interface CcrRecord {
  hash: string;
  /** The original (pre-compression) content this hash refers to. */
  content: string;
  timestamp: string;
}

export interface CcrStoreOptions {
  /** Override the store's home directory (defaults to getOptiflowHome()). */
  home?: string;
}

function ccrStorePath(home: string): string {
  return path.join(home, "ccr-store.jsonl");
}

/**
 * Stores `content` keyed by `hash`. Append-only (like `ledger.ts`) rather
 * than an update-in-place file format — a later `get()` for the same hash
 * resolves to the LAST matching record (last-write-wins), so re-storing
 * the same hash with different content is safe, just not space-efficient.
 * Never throws: a failed write is swallowed so a CCR store problem can
 * never break the compression call site that triggered it.
 */
export function putCcr(
  hash: string,
  content: string,
  options: CcrStoreOptions = {}
): void {
  try {
    const home = options.home ?? getOptiflowHome();
    mkdirSync(home, { recursive: true });
    const record: CcrRecord = {
      hash,
      content,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(ccrStorePath(home), JSON.stringify(record) + "\n", "utf8");
  } catch {
    // CCR store writes must never break the calling compression path.
  }
}

/**
 * Retrieves the original content for `hash`, or `undefined` if no record
 * with that hash exists (including: store file doesn't exist yet, file is
 * unreadable, or every line failed to parse). Scans the whole file and
 * returns the LAST matching record (last-write-wins, matching `putCcr`'s
 * append semantics). Simple linear scan — acceptable at this phase's
 * scale; a later phase can add an index/SQLite backend without changing
 * this function's contract if volume ever requires it.
 */
export function getCcr(
  hash: string,
  options: CcrStoreOptions = {}
): string | undefined {
  try {
    const home = options.home ?? getOptiflowHome();
    const file = ccrStorePath(home);
    if (!existsSync(file)) return undefined;

    const raw = readFileSync(file, "utf8");
    let found: string | undefined;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.hash === "string" &&
          typeof parsed.content === "string" &&
          parsed.hash === hash
        ) {
          found = parsed.content;
        }
      } catch {
        continue;
      }
    }
    return found;
  } catch {
    return undefined;
  }
}
