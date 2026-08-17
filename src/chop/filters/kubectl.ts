// Filter for `kubectl` output. `kubectl get ...` (default table format)
// truncates rows when there are many; `kubectl get ... -o json` (or
// `-o=json`/`--output json`/`--output=json`) is JSON and MUST NOT be broken
// by string slicing, so per the plan's instruction this defers entirely to
// `generic.ts`'s JSON-safe path rather than reimplementing JSON handling.
//
// KNOWN LIMITATION: real `kubectl get ... -o json` output is shaped
// `{apiVersion, kind, items: [...]}` — an object at the top level, not a
// top-level array. `generic.ts`'s uniform-array detection only inspects the
// TOP-level value, so it never fires on the nested `items` array, and this
// filter passes the payload through at full size (verbatim, never
// corrupted — the "don't break JSON semantics" requirement is still met,
// just without the compression a smarter nested-array-aware pass could
// achieve). Documented here rather than worked around, since a real fix
// belongs in `generic.ts` (recursing into known array-bearing keys) and
// would affect every JSON-shaped filter path, not just this one.

import { genericFilter } from "./generic.js";
import type { FilterInput, FilterOutput } from "./types.js";

const MAX_ROWS = 15;

function requestsJsonOutput(args: string[]): boolean {
  return args.some(
    (arg, i) =>
      arg === "-o=json" ||
      arg === "--output=json" ||
      ((arg === "-o" || arg === "--output") && args[i + 1] === "json")
  );
}

function truncateTable(stdout: string): { text: string; totalRows: number; shownRows: number } | null {
  const lines = stdout.split("\n").filter((line, i) => i === 0 || line.trim().length > 0);
  if (lines.length < 2) return null; // no header + at least one row worth truncating

  const header = lines[0];
  const rows = lines.slice(1);
  if (rows.length <= MAX_ROWS) return null;

  const shown = rows.slice(0, MAX_ROWS);
  const omitted = rows.length - MAX_ROWS;
  return {
    text: [header, ...shown, `... and ${omitted} more (${rows.length} total)`].join("\n"),
    totalRows: rows.length,
    shownRows: shown.length,
  };
}

export function kubectlFilter(input: FilterInput): FilterOutput {
  if (requestsJsonOutput(input.args)) {
    // Deliberately deferred, not reimplemented — see module header.
    return genericFilter(input);
  }

  const truncated = truncateTable(input.stdout);
  if (!truncated) {
    // Short output, or not a recognizable table (e.g. `kubectl describe`,
    // which is a long free-form block, not a table): generic head+tail
    // truncation is the safest default.
    return genericFilter(input);
  }

  return {
    text: truncated.text,
    formatHint: "table",
    meta: { totalRows: truncated.totalRows, shownRows: truncated.shownRows },
  };
}
