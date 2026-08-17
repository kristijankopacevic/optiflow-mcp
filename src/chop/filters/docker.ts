// Filter for `docker` output. `docker ps`/`docker images` print a
// space-aligned table whose column boundaries are only recoverable from the
// header row's text offsets (docker's default table format has no
// delimiter). Trims to the columns an agent actually needs and truncates
// rows when there are many.

import { genericFilter } from "./generic.js";
import type { FilterInput, FilterOutput } from "./types.js";

const MAX_ROWS = 10;

// Column headers docker's default `ps`/`images` table format may emit, in
// no particular order — detected by locating each in the header line.
const KNOWN_HEADERS = [
  "CONTAINER ID",
  "IMAGE",
  "COMMAND",
  "CREATED",
  "STATUS",
  "PORTS",
  "NAMES",
  "SIZE",
  "REPOSITORY",
  "TAG",
  "DIGEST",
];

// Columns kept when trimming (per the plan: "table trimmed to relevant
// columns") — COMMAND/CREATED/PORTS/DIGEST tend to be long and least useful
// for an agent deciding what's running; the identifying + health columns
// are kept.
const KEEP_HEADERS = ["CONTAINER ID", "REPOSITORY", "TAG", "IMAGE", "STATUS", "NAMES"];

interface ParsedTable {
  headers: { name: string; start: number }[];
  rows: string[][];
}

function parseAlignedTable(lines: string[]): ParsedTable | null {
  if (lines.length === 0) return null;
  const headerLine = lines[0];
  const found = KNOWN_HEADERS.map((name) => ({ name, start: headerLine.indexOf(name) }))
    .filter((h) => h.start >= 0)
    .sort((a, b) => a.start - b.start);
  if (found.length === 0) return null;

  const rows = lines
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) =>
      found.map((h, i) => {
        const end = i + 1 < found.length ? found[i + 1].start : line.length;
        return line.slice(h.start, end).trim();
      })
    );
  return { headers: found, rows };
}

export function dockerFilter(input: FilterInput): FilterOutput {
  const lines = input.stdout.split("\n");
  const table = parseAlignedTable(lines);
  if (!table) return genericFilter(input);

  const keepIndexes = table.headers
    .map((h, i) => ({ name: h.name, i }))
    .filter((h) => KEEP_HEADERS.includes(h.name));
  const keptHeaderNames = keepIndexes.map((h) => h.name);

  const trimmedRows = table.rows.map((row) => keepIndexes.map(({ i }) => row[i]));
  const truncated = trimmedRows.length > MAX_ROWS;
  const shownRows = truncated ? trimmedRows.slice(0, MAX_ROWS) : trimmedRows;

  const colWidths = keptHeaderNames.map((name, i) =>
    Math.max(name.length, ...shownRows.map((r) => (r[i] ?? "").length))
  );
  const renderRow = (cells: string[]): string =>
    cells.map((c, i) => (c ?? "").padEnd(colWidths[i] + 2)).join("").trimEnd();

  const out = [renderRow(keptHeaderNames), ...shownRows.map(renderRow)];
  if (truncated) {
    out.push(`... and ${trimmedRows.length - MAX_ROWS} more (${trimmedRows.length} total)`);
  }

  return {
    text: out.join("\n"),
    formatHint: "table",
    meta: { totalRows: trimmedRows.length, shownRows: shownRows.length },
  };
}
