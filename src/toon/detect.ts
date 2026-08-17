// Sniffs whether a string is likely JSON, CSV, or YAML, and — for JSON
// specifically — scores "uniformity" (is it a top-level array of objects
// that mostly share the same keys?), since that's what determines whether
// TOON's tabular encoding is worth attempting at all: TOON only shrinks
// uniform tabular data, and can be *larger* than the original JSON on
// non-uniform/deeply-nested shapes (see `guard.ts` for the measured check
// that's the actual authority on whether to use it).
//
// `isPlainObject`/`isUniformObjectArray` are the canonical home for logic
// that used to be defined locally inside `src/chop/filters/generic.ts`
// (Phase 3). Per the Phase 5 plan instructions, that duplicate has been
// removed there in favor of importing from here, rather than this module
// reimplementing (or duplicating) the same key-set comparison a second time.
// This also avoids a circular import: `generic.ts` depends on `src/toon/**`
// (to call `maybeConvertToToon`), so the shared helper has to live on the
// `toon` side, not vice versa.
//
// Deliberately has ZERO dependency on `@toon-format/toon` (or on
// `chop/filters/**`) — detection is pure string/JSON sniffing so it stays
// safe to import from anywhere, including (transitively, via `index.ts` ->
// `convert.ts`) the one place that really does need the encoder.

export type DetectedFormat = "json" | "csv" | "yaml" | "text";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True if every element of `arr` is a plain object with exactly the same key set. */
export function isUniformObjectArray(arr: unknown[]): boolean {
  if (arr.length === 0 || !isPlainObject(arr[0])) return false;
  const firstKeys = Object.keys(arr[0]).sort().join(",");
  return arr.every((item) => isPlainObject(item) && Object.keys(item).sort().join(",") === firstKeys);
}

export interface JsonUniformity {
  /** True if the parsed value is a top-level array. */
  isArray: boolean;
  /** Number of top-level elements, if an array (0 otherwise). */
  rowCount: number;
  /**
   * Fraction (0..1) of elements sharing the single most common key-set
   * signature among plain-object elements. 0 if the array is empty, or
   * contains no plain objects at all.
   */
  keyOverlapRatio: number;
  /** True under the strict rule: every element is a plain object with an IDENTICAL key set. */
  strictlyUniform: boolean;
}

const EMPTY_UNIFORMITY: JsonUniformity = {
  isArray: false,
  rowCount: 0,
  keyOverlapRatio: 0,
  strictlyUniform: false,
};

/** Scores how "table-shaped" a parsed JSON value is. Non-arrays always score empty/false. */
export function scoreJsonUniformity(value: unknown): JsonUniformity {
  if (!Array.isArray(value)) return EMPTY_UNIFORMITY;
  if (value.length === 0) return { isArray: true, rowCount: 0, keyOverlapRatio: 0, strictlyUniform: false };

  const signatureCounts = new Map<string, number>();
  let plainObjectCount = 0;
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    plainObjectCount++;
    const signature = Object.keys(item).sort().join(",");
    signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
  }

  let mode = 0;
  for (const count of signatureCounts.values()) mode = Math.max(mode, count);

  return {
    isArray: true,
    rowCount: value.length,
    keyOverlapRatio: plainObjectCount === 0 ? 0 : mode / value.length,
    strictlyUniform: isUniformObjectArray(value),
  };
}

export interface DetectResult {
  format: DetectedFormat;
  /** Present only when `format === "json"` and the text parsed successfully. */
  json?: { value: unknown; uniformity: JsonUniformity };
}

function tryParseJson(trimmed: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

/**
 * Cheap comma-count sniff for CSV — NOT the real parser (that's
 * `convert.ts`'s `parseCsv`, which handles quoting). Only used here to
 * decide "does this look rectangular enough to be worth trying," so it
 * intentionally ignores quoted commas; a quoted-comma CSV might undercount
 * here and get sniffed as something else, which just means conversion isn't
 * attempted (safe: never a correctness issue, only a missed opportunity).
 */
function naiveCsvFieldCount(line: string): number {
  return line.split(",").length;
}

function looksLikeCsv(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const sample = lines.slice(0, Math.min(lines.length, 20));
  const firstCount = naiveCsvFieldCount(sample[0]);
  if (firstCount < 2) return false;
  return sample.every((l) => naiveCsvFieldCount(l) === firstCount);
}

// One deliberately narrow rule, per review: a line counts as "YAML-shaped"
// only if it starts with a lowercase-leading identifier-ish key immediately
// followed by `:` and then whitespace-or-end-of-line. This is what
// distinguishes real YAML mappings ("name: Ada", "count: 3") from ordinary
// log lines that happen to contain a colon ("INFO: something happened" —
// "INFO" fails the lowercase-leading check). Requiring >=2 *distinct* such
// keys additionally rules out a log stream that repeats one key
// ("2026-01-01: message one", "2026-01-02: message two" would still pass —
// accepted as a known, harmless limitation, since misdetecting as YAML is
// safe: `convert.ts`'s YAML path always declines conversion and returns the
// original, never corrupts anything).
const YAML_KEY_LINE = /^[\s-]*([a-z][a-z0-9_-]*):(\s|$)/;

function looksLikeYaml(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
  if (lines.length === 0) return false;
  const distinctKeys = new Set<string>();
  let matching = 0;
  for (const line of lines) {
    const m = YAML_KEY_LINE.exec(line);
    if (m) {
      matching++;
      distinctKeys.add(m[1]);
    }
  }
  return matching / lines.length >= 0.6 && distinctKeys.size >= 2;
}

/**
 * Detects the likely format of `text`. JSON is checked first (and, if it
 * parses, comes back with a uniformity score attached); otherwise CSV, then
 * YAML; otherwise `"text"` (plain/log output — never misdetected as one of
 * the above just because it contains a stray comma or colon).
 */
export function detectFormat(text: string): DetectResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { format: "text" };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJson(trimmed);
    if (parsed.ok) {
      return { format: "json", json: { value: parsed.value, uniformity: scoreJsonUniformity(parsed.value) } };
    }
    // Starts with `{`/`[` but doesn't actually parse — fall through to the
    // other sniffs rather than assuming JSON.
  }

  if (looksLikeCsv(trimmed)) return { format: "csv" };
  if (looksLikeYaml(trimmed)) return { format: "yaml" };
  return { format: "text" };
}
