// Public entry point for Module 5 (TOON conversion): composes
// detect -> convert -> guard and exposes a single call, safe to use from a
// hook's hot path — it NEVER throws out to the caller. Any failure at any
// stage (detection inconclusive, conversion declined, or the savings guard
// rejecting it) resolves to `{ ok: false, output: input, reason }`, i.e.
// "use the original, here is why."

import { detectFormat, type DetectResult } from "./detect.js";
import { convertToToon, type ToonSourceFormat } from "./convert.js";
import { evaluateGuard, type GuardResult } from "./guard.js";

export type { DetectedFormat, DetectResult, JsonUniformity } from "./detect.js";
export { detectFormat, scoreJsonUniformity, isPlainObject, isUniformObjectArray } from "./detect.js";
export { convertToToon, convertJsonValueToToon, convertCsvToToon, convertYamlToToon, parseCsv, encode, decode } from "./convert.js";
export type { ConvertResult, ConvertOptions, ToonSourceFormat } from "./convert.js";
export { evaluateGuard } from "./guard.js";
export type { GuardOptions, GuardResult } from "./guard.js";

export interface ToonConfig {
  enabled: boolean;
  minSavingsPercent: number;
  minRows: number;
}

export interface MaybeConvertResult {
  /** True only when the TOON output was approved by the guard and should replace the original. */
  ok: boolean;
  /** The TOON text when `ok`, otherwise the untouched original `input`. */
  output: string;
  format?: ToonSourceFormat;
  reason: string;
  /** Present whenever the guard actually ran a token comparison (i.e. conversion succeeded and had a row count worth measuring). */
  guard?: GuardResult;
}

function rowCountFor(detected: DetectResult, rawInputForCsv: string): number {
  if (detected.format === "json") {
    return detected.json?.uniformity.rowCount ?? 0;
  }
  if (detected.format === "csv") {
    // Cheap re-derivation of the data-row count via the same naive sniff
    // detect.ts uses for CSV recognition (non-blank lines minus the header).
    // convert.ts's real `parseCsv` is the source of truth for the actual
    // conversion; this is only used to gate whether it's worth calling it.
    const nonBlank = rawInputForCsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return Math.max(0, nonBlank.length - 1);
  }
  return 0;
}

/**
 * Runs the full detect -> convert -> guard pipeline. Returns "use original"
 * (`ok: false`, `output` equal to `input`) whenever:
 *   - `config.enabled` is false,
 *   - the input doesn't look like JSON/CSV/YAML,
 *   - the format-specific converter declines (e.g. YAML — see convert.ts),
 *   - there aren't enough rows to bother (`config.minRows`), or
 *   - the measured token savings are below `config.minSavingsPercent`.
 * Anything unexpected (a thrown error anywhere in detect/convert/guard) is
 * caught here too, so this is always safe to call from a hook's hot path.
 */
export function maybeConvertToToon(input: string, config: ToonConfig): MaybeConvertResult {
  try {
    if (!config.enabled) {
      return { ok: false, output: input, reason: "toon.enabled is false" };
    }

    const detected = detectFormat(input);
    if (detected.format === "text") {
      return { ok: false, output: input, reason: "input does not look like JSON, CSV, or YAML" };
    }

    const rowCount = rowCountFor(detected, input);
    if (rowCount < config.minRows) {
      return {
        ok: false,
        output: input,
        reason: `only ${rowCount} row(s), below toon.minRows (${config.minRows}) — not worth attempting`,
      };
    }

    const converted = convertToToon(input, { detected });
    if (!converted.ok || !converted.output) {
      return { ok: false, output: input, reason: converted.reason ?? "TOON conversion declined" };
    }

    const guard = evaluateGuard(input, converted.output, rowCount, {
      minSavingsPercent: config.minSavingsPercent,
      minRows: config.minRows,
    });

    if (!guard.approved) {
      return { ok: false, output: input, format: converted.format, reason: guard.reason, guard };
    }

    return { ok: true, output: converted.output, format: converted.format, reason: guard.reason, guard };
  } catch (err) {
    return {
      ok: false,
      output: input,
      reason: `TOON pipeline threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
