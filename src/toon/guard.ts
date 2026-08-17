// The mandatory savings guard (plan Phase 5, non-negotiable): TOON's win is
// uniform tabular data — on non-uniform/deeply-nested JSON, or on too few
// rows to amortize tabular-format overhead, TOON can come out the SAME
// SIZE OR LARGER than the original. This module is the single place that
// decides "use the TOON output" vs. "keep the original," and it decides
// that using REAL measured token counts (`src/core/tokens.ts`), never a
// guess based on byte length or row count alone.
//
// IMPORTANT baseline choice: the guard always measures against the
// ORIGINAL raw input string, not against whatever an upstream filter might
// otherwise fall back to (e.g. `generic.ts`'s Phase-3 head+tail truncation
// of a large uniform array). Those two baselines are NOT the same thing:
// truncated JSON can look smaller in raw token count while silently
// discarding rows, whereas TOON is lossless over the full array. Comparing
// against the truncated fallback would make TOON look worse than it is for
// the wrong reason (it's carrying strictly more information) and would
// cause the guard to reject almost everything. Comparing against the full
// original is the fair, apples-to-apples measurement the plan's "measure
// actual token savings" requirement calls for.

import { countTokens } from "../core/tokens.js";

export interface GuardOptions {
  /** Minimum required (tokensBefore - tokensAfter) / tokensBefore, as a percentage 0..100. */
  minSavingsPercent: number;
  /** Minimum row count (array length / CSV data-row count) before even attempting the comparison is worth it. */
  minRows: number;
}

export interface GuardResult {
  approved: boolean;
  reason: string;
  tokensBefore: number;
  tokensAfter: number;
  /** (tokensBefore - tokensAfter) / tokensBefore * 100. Can be negative if TOON is larger. */
  savingsPercent: number;
}

/**
 * Evaluates whether `candidateToon` should replace `original`. `rowCount`
 * is the caller's own count of "how many tabular rows does this represent"
 * (top-level array length for JSON, data-row count for CSV) — this module
 * doesn't infer it, since that's format-specific and already known by
 * whoever ran `detect.ts`/`convert.ts`.
 */
export function evaluateGuard(original: string, candidateToon: string, rowCount: number, opts: GuardOptions): GuardResult {
  const tokensBefore = countTokens(original);
  const tokensAfter = countTokens(candidateToon);
  const savingsPercent = tokensBefore === 0 ? 0 : ((tokensBefore - tokensAfter) / tokensBefore) * 100;

  if (rowCount < opts.minRows) {
    return {
      approved: false,
      reason: `only ${rowCount} row(s), below toon.minRows (${opts.minRows}) — not worth attempting`,
      tokensBefore,
      tokensAfter,
      savingsPercent,
    };
  }

  if (savingsPercent < opts.minSavingsPercent) {
    return {
      approved: false,
      reason: `would save only ${savingsPercent.toFixed(1)}%, below toon.minSavingsPercent (${opts.minSavingsPercent}%)`,
      tokensBefore,
      tokensAfter,
      savingsPercent,
    };
  }

  return {
    approved: true,
    reason: `saves ${savingsPercent.toFixed(1)}% (>= toon.minSavingsPercent ${opts.minSavingsPercent}%)`,
    tokensBefore,
    tokensAfter,
    savingsPercent,
  };
}
