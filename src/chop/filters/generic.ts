// Fallback filter for anything not matched by a specific per-binary filter
// (and also used by kubectl.ts for `-o json` output, per the plan's
// instruction to "defer to generic.ts's JSON path" rather than reimplement
// JSON-safe summarization twice).
//
// Heuristics, in order:
//   1. If the text parses as JSON:
//      - a uniform array of objects (every element is a plain object with
//        the same set of keys) is flagged `formatHint: "uniform-json-array"`
//        — this is the extension point a later phase (Module 5 / TOON,
//        Phase 5) wires TOON conversion into. This phase does NOT implement
//        TOON itself; it truncates the array (head+tail with an omitted
//        count) so large arrays still shrink today.
//      - any other JSON value is left untouched structurally (never
//        string-sliced, which would break JSON), tagged `formatHint: "json"`.
//   2. Otherwise, treat it as line-oriented text/log output: if there are
//      more than `LOG_HEAD_LINES + LOG_TAIL_LINES` lines, keep the first
//      `LOG_HEAD_LINES` and last `LOG_TAIL_LINES`, with a
//      "... N lines omitted ..." marker in between.
//   3. If neither applies (short output), return unchanged.

import type { FilterInput, FilterOutput } from "./types.js";

const LOG_HEAD_LINES = 20;
const LOG_TAIL_LINES = 10;
const JSON_ARRAY_HEAD_ITEMS = 10;
const JSON_ARRAY_TAIL_ITEMS = 5;
const UNIFORM_ARRAY_THRESHOLD = JSON_ARRAY_HEAD_ITEMS + JSON_ARRAY_TAIL_ITEMS + 1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True if every element of `arr` is a plain object with the same key set. */
function isUniformObjectArray(arr: unknown[]): boolean {
  if (arr.length === 0 || !isPlainObject(arr[0])) return false;
  const firstKeys = Object.keys(arr[0]).sort().join(",");
  return arr.every((item) => isPlainObject(item) && Object.keys(item).sort().join(",") === firstKeys);
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
function tryJsonFilter(text: string): FilterOutput | null {
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
    const { value, omitted } = truncateUniformArray(parsed);
    return {
      text: JSON.stringify(value, null, 2),
      formatHint: "uniform-json-array",
      meta: { itemCount: parsed.length, omittedItems: omitted },
    };
  }

  // Any other JSON shape: never string-slice it (would break JSON
  // semantics) — hand it back verbatim, just tagged for later phases.
  return { text: trimmed, formatHint: "json" };
}

/** Generic fallback filter: JSON-aware, otherwise line-oriented head+tail truncation. */
export function genericFilter(input: FilterInput): FilterOutput {
  const jsonResult = tryJsonFilter(input.stdout);
  if (jsonResult) return jsonResult;

  const { text, truncated, omitted } = truncateLogLines(input.stdout);
  return {
    text,
    formatHint: truncated ? "log" : "plain",
    ...(truncated ? { meta: { omittedLines: omitted } } : {}),
  };
}
