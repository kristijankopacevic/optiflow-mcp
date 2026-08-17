// Fallback filter for anything not matched by a specific per-binary filter
// (and also used by kubectl.ts for `-o json` output, per the plan's
// instruction to "defer to generic.ts's JSON path" rather than reimplement
// JSON-safe summarization twice).
//
// Heuristics, in order:
//   1. If the text parses as JSON:
//      - a uniform array of objects (every element is a plain object with
//        the same set of keys) is flagged `formatHint: "uniform-json-array"`.
//        Phase 5 / Module 5 wires TOON conversion in right here: it's tried
//        first via `maybeConvertToToon` (which runs its own mandatory
//        measured-savings guard — see `src/toon/guard.ts` — and can decline
//        for reasons ranging from "disabled" to "not enough rows" to "not
//        enough real measured savings"). Only when TOON is declined does
//        this fall back to the Phase-3 behavior: truncating the array
//        (head+tail with an omitted count) so large arrays still shrink
//        even when TOON doesn't help on this particular shape.
//      - any other JSON value is left untouched structurally (never
//        string-sliced, which would break JSON), tagged `formatHint: "json"`.
//   2. Otherwise, treat it as line-oriented text/log output: if there are
//      more than `LOG_HEAD_LINES + LOG_TAIL_LINES` lines, keep the first
//      `LOG_HEAD_LINES` and last `LOG_TAIL_LINES`, with a
//      "... N lines omitted ..." marker in between.
//   3. If neither applies (short output), return unchanged.

import type { FilterInput, FilterOutput } from "./types.js";
import { isUniformObjectArray } from "../../toon/detect.js";
import { maybeConvertToToon, type ToonConfig } from "../../toon/index.js";
import { loadConfig } from "../../config/load.js";

const LOG_HEAD_LINES = 20;
const LOG_TAIL_LINES = 10;
const JSON_ARRAY_HEAD_ITEMS = 10;
const JSON_ARRAY_TAIL_ITEMS = 5;
const UNIFORM_ARRAY_THRESHOLD = JSON_ARRAY_HEAD_ITEMS + JSON_ARRAY_TAIL_ITEMS + 1;

// A safe "do nothing" fallback if resolving the real config throws for any
// reason (must never make this filter crash a hook) — equivalent to
// toon.enabled: false, so callers who don't pass an explicit `toonConfig`
// just get the pre-Phase-5 truncation behavior on failure.
const SAFE_DISABLED_TOON_CONFIG: ToonConfig = { enabled: false, minSavingsPercent: 100, minRows: Number.MAX_SAFE_INTEGER };

// Loaded (and validated) at most once per process — `loadConfig()` does a
// synchronous filesystem read, and this filter can run many times within a
// single short-lived hook process (once per wrapped command's output).
let cachedDefaultToonConfig: ToonConfig | null = null;

function defaultToonConfig(): ToonConfig {
  if (cachedDefaultToonConfig) return cachedDefaultToonConfig;
  try {
    cachedDefaultToonConfig = loadConfig().config.toon;
  } catch {
    cachedDefaultToonConfig = SAFE_DISABLED_TOON_CONFIG;
  }
  return cachedDefaultToonConfig;
}

function truncateLogLines(text: string): { text: string; truncated: boolean; omitted: number } {
  const lines = text.split("\n");
  if (lines.length <= LOG_HEAD_LINES + LOG_TAIL_LINES) {
    return { text, truncated: false, omitted: 0 };
  }
  const head = lines.slice(0, LOG_HEAD_LINES);
  const tail = lines.slice(lines.length - LOG_TAIL_LINES);
  const omitted = lines.length - LOG_HEAD_LINES - LOG_TAIL_LINES;
  const marker = `... [${omitted} lines omitted] ...`;
  return { text: [...head, marker, ...tail].join("\n"), truncated: true, omitted };
}

function truncateUniformArray(arr: unknown[]): { value: unknown[]; omitted: number } {
  if (arr.length <= UNIFORM_ARRAY_THRESHOLD) return { value: arr, omitted: 0 };
  const head = arr.slice(0, JSON_ARRAY_HEAD_ITEMS);
  const tail = arr.slice(arr.length - JSON_ARRAY_TAIL_ITEMS);
  const omitted = arr.length - JSON_ARRAY_HEAD_ITEMS - JSON_ARRAY_TAIL_ITEMS;
  return {
    value: [...head, `... [${omitted} items omitted] ...`, ...tail],
    omitted,
  };
}

/**
 * Attempts the JSON path. Returns `null` if `text` doesn't parse as JSON, so
 * the caller can fall through to the line-oriented heuristic.
 */
function tryJsonFilter(text: string, toonConfig: ToonConfig): FilterOutput | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || !(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (Array.isArray(parsed) && isUniformObjectArray(parsed)) {
    // Try TOON first — it's lossless over the FULL array (unlike the
    // truncation fallback below, which discards rows), so it's always
    // preferred when the mandatory measured-savings guard approves it.
    const toonAttempt = maybeConvertToToon(trimmed, toonConfig);
    if (toonAttempt.ok) {
      return {
        text: toonAttempt.output,
        formatHint: "uniform-json-array",
        meta: {
          itemCount: parsed.length,
          toon: { applied: true, format: toonAttempt.format, ...toonAttempt.guard },
        },
      };
    }

    // TOON declined (disabled / not enough rows / not enough measured
    // savings — see toonAttempt.reason) — fall back to the Phase-3
    // head+tail truncation so large arrays still shrink today even when
    // TOON doesn't help on this particular shape.
    const { value, omitted } = truncateUniformArray(parsed);
    return {
      text: JSON.stringify(value, null, 2),
      formatHint: "uniform-json-array",
      meta: {
        itemCount: parsed.length,
        omittedItems: omitted,
        toon: { applied: false, reason: toonAttempt.reason },
      },
    };
  }

  // Any other JSON shape: never string-slice it (would break JSON
  // semantics) — hand it back verbatim, just tagged for later phases.
  return { text: trimmed, formatHint: "json" };
}

export interface GenericFilterOptions {
  /**
   * The `toon` config section to use for the TOON-conversion attempt on
   * uniform JSON arrays. Defaults to the resolved `optiflow.config.json`'s
   * `toon` section (loaded at most once per process). Tests should always
   * pass this explicitly rather than relying on whatever config happens to
   * be on disk.
   */
  toonConfig?: ToonConfig;
}

/** Generic fallback filter: JSON-aware (TOON-aware for uniform arrays), otherwise line-oriented head+tail truncation. */
export function genericFilter(input: FilterInput, options: GenericFilterOptions = {}): FilterOutput {
  const toonConfig = options.toonConfig ?? defaultToonConfig();
  const jsonResult = tryJsonFilter(input.stdout, toonConfig);
  if (jsonResult) return jsonResult;

  const { text, truncated, omitted } = truncateLogLines(input.stdout);
  return {
    text,
    formatHint: truncated ? "log" : "plain",
    ...(truncated ? { meta: { omittedLines: omitted } } : {}),
  };
}
