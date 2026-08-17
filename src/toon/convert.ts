// Wraps `@toon-format/toon`'s real exported API. Confirmed against
// node_modules/@toon-format/toon/dist/index.d.mts (v4.1.1) rather than
// assumed: the package exports `encode(input: unknown, options?): string`
// and `decode(input: string, options?): JsonValue` (plus `encodeLines` /
// `decodeFromLines` / streaming variants this module doesn't need). There
// is no separate "CSV mode" or "YAML mode" in the library itself — it only
// ever encodes/decodes a JS value tree to/from TOON text. CSV/YAML support
// below is optiflow's own (minimal) text -> JS-value bridge in front of the
// same `encode` call.
//
// Reversibility: `encode`/`decode` round-trip losslessly for the JSON path
// in normal use (confirmed in convert.test.ts) because TOON's whole design
// goal is a faithful, information-preserving re-encoding of a JSON value —
// but this module still never trusts that blindly. Every function here
// returns `{ ok: false, reason }` instead of throwing on anything
// unexpected, and the CSV path in particular is explicit about where it
// loses fidelity (all values become strings — no type inference) rather
// than silently guessing types back.

import { encode as toonEncode, decode as toonDecode } from "@toon-format/toon";
import { detectFormat, type DetectResult } from "./detect.js";

export type ToonSourceFormat = "json" | "csv" | "yaml";

export interface ConvertResult {
  ok: boolean;
  output?: string;
  format?: ToonSourceFormat;
  reason?: string;
}

/** Re-exported so callers/tests can round-trip without a second import of the raw package. */
export const encode = toonEncode;
export const decode = toonDecode;

/** Encodes an already-parsed JSON value to TOON text. Never throws outward. */
export function convertJsonValueToToon(value: unknown): ConvertResult {
  try {
    return { ok: true, output: toonEncode(value as never), format: "json" };
  } catch (err) {
    return { ok: false, reason: `TOON encode threw on JSON input: ${errorMessage(err)}` };
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Minimal RFC4180-ish CSV parser: comma-delimited fields, double-quote
 * quoting with `""` as an escaped quote inside a quoted field, `\n`/`\r\n`
 * row separators. Deliberately does NOT support alternate delimiters
 * (semicolon/tab), comments, or byte-order marks. This exists so CSV can be
 * converted without adding a parser dependency; if the input doesn't
 * actually look rectangular, or a quote is left unterminated, this returns
 * `null` rather than guessing at a shape and silently mangling data.
 */
export function parseCsv(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyContent = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAnyContent = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      sawAnyContent = true;
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    sawAnyContent = true;
    i++;
  }

  if (inQuotes) return null; // unterminated quote — malformed, decline rather than guess

  // Flush a trailing field/row for input that doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!sawAnyContent && rows.length <= 1) return null;
  return rows;
}

/**
 * Converts CSV text to TOON via a header-row + data-rows -> array-of-objects
 * bridge. LIMITATION (documented, not silently swallowed): every CSV value
 * becomes a string in the resulting object — there is no numeric/boolean
 * type inference, so `"3"` stays the string `"3"` rather than becoming the
 * number `3`. That is safe (never corrupts data) but means the caller
 * should not assume the TOON output round-trips back to typed JSON.
 */
export function convertCsvToToon(text: string): ConvertResult {
  const rows = parseCsv(text);
  if (!rows || rows.length < 2) {
    return { ok: false, reason: "CSV did not parse into a header row plus at least one data row" };
  }
  const [header, ...dataRows] = rows;
  if (header.length === 0 || header.some((h) => h.trim().length === 0)) {
    return { ok: false, reason: "CSV header is missing or contains an empty column name" };
  }
  if (!dataRows.every((r) => r.length === header.length)) {
    return { ok: false, reason: "CSV rows have inconsistent column counts; declining to guess" };
  }

  const objects = dataRows.map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx];
    });
    return obj;
  });

  try {
    return { ok: true, output: toonEncode(objects as never), format: "csv" };
  } catch (err) {
    return { ok: false, reason: `TOON encode threw on CSV-derived rows: ${errorMessage(err)}` };
  }
}

// ---------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------

/**
 * YAML conversion is intentionally NOT implemented in this phase: optiflow
 * has no YAML parser dependency (adding one is out of this phase's scope —
 * `@toon-format/toon` was the only dependency approved for Module 5), and a
 * hand-rolled YAML parser well-behaved enough to avoid silently mangling
 * anchors/aliases, multi-document streams, block scalars, or flow
 * collections is a much bigger undertaking than CSV's simple rectangular
 * grid. `detect.ts` still recognizes YAML so callers get an honest
 * "skipped, here is why" message — this always safely degrades to
 * "return original," never a corrupting guess.
 */
export function convertYamlToToon(_text: string): ConvertResult {
  return {
    ok: false,
    reason: "YAML conversion is not implemented in this phase (no YAML parser dependency); returning original",
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface ConvertOptions {
  /** Pre-computed detection result, to skip re-parsing when the caller already ran `detectFormat`. */
  detected?: DetectResult;
}

/**
 * Detects (unless `opts.detected` is supplied) and converts `input` to TOON
 * text. Returns `{ ok: false, reason }` — never throws — for anything that
 * doesn't look like JSON/CSV/YAML, or that a format-specific converter
 * declines. Callers that care about token savings still need `guard.ts`;
 * this function only answers "can a TOON string be produced at all."
 */
export function convertToToon(input: string, opts: ConvertOptions = {}): ConvertResult {
  const detected = opts.detected ?? detectFormat(input);
  switch (detected.format) {
    case "json":
      if (!detected.json) return { ok: false, reason: "detected as JSON but no parsed value was available" };
      return convertJsonValueToToon(detected.json.value);
    case "csv":
      return convertCsvToToon(input);
    case "yaml":
      return convertYamlToToon(input);
    case "text":
    default:
      return { ok: false, reason: `input does not look like JSON, CSV, or YAML (detected: ${detected.format})` };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
