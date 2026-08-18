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
//        enough real measured savings"). When TOON is declined, Phase 5c
//        tries the real headroom-core `SmartCrusher` WASM algorithm next
//        (`src/native/smart-crusher.ts`) — its own importance-based
//        row-sampling/clustering is a strictly smarter lossy fallback than
//        the dumb head+tail truncation below, and (unlike that truncation)
//        it's CCR-retrievable: dropped rows aren't just gone, they're
//        stashed in `src/native/ccr-store.ts` keyed by the marker hash
//        SmartCrusher emits, retrievable later via `optiflow ccr-retrieve
//        <hash>`. Only when SmartCrusher ALSO doesn't measurably help does
//        this fall back to the Phase-3 behavior: truncating the array
//        (head+tail with an omitted count) so large arrays still shrink
//        even when neither smarter option helps on this particular shape.
//      - any other JSON value (objects, non-uniform arrays, nested
//        structures) is never string-sliced (which would break JSON), but
//        Phase 5c also tries SmartCrusher on it here — `crusher.rs`'s
//        `smart_crush_content` genuinely operates on ANY JSON value
//        (recursing into arrays at every depth, substituting long opaque
//        string blobs with CCR markers too), not just top-level uniform
//        arrays; this is real, structure-preserving compression, not a
//        truncation. Declines (guard-rejected or the WASM module simply
//        passing through) leave the value exactly as before. Tagged
//        `formatHint: "json"` either way.
//   2. Otherwise, treat it as line-oriented text/log output: if there are
//      more than `LOG_HEAD_LINES + LOG_TAIL_LINES` lines, keep the first
//      `LOG_HEAD_LINES` and last `LOG_TAIL_LINES`, with a
//      "... N lines omitted ..." marker in between. SmartCrusher is
//      deliberately NOT attempted here: `crusher.rs`'s own
//      `smart_crush_content` (`native/headroom-core/src/transforms/smart_crusher/crusher.rs`,
//      the JSON-parse-or-passthrough gate right at its entry) hands back
//      non-JSON content completely untouched (`wasModified: false`) —
//      confirmed by `src/native/smart-crusher.test.ts`'s own "passes
//      through non-JSON content without crashing" case — so calling it on
//      plain log lines can never do anything but burn a WASM call for zero
//      possible benefit.
//   3. If neither applies (short output), return unchanged.

import type { FilterInput, FilterOutput } from "./types.js";
import { isUniformObjectArray } from "../../toon/detect.js";
import { maybeConvertToToon, evaluateGuard, type GuardResult, type ToonConfig } from "../../toon/index.js";
import { loadConfig } from "../../config/load.js";
import { ccrMarkerHashFor, compress as smartCrush, extractCcrHashes } from "../../native/smart-crusher.js";
import { putCcr } from "../../native/ccr-store.js";

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

/** Mirrors `src/config/schema.ts`'s `SmartCrusherSchema` shape. */
export interface SmartCrusherFilterConfig {
  enabled: boolean;
  minSavingsPercent: number;
}

// Same "fail open, disabled" shape as `SAFE_DISABLED_TOON_CONFIG` above.
const SAFE_DISABLED_SMART_CRUSHER_CONFIG: SmartCrusherFilterConfig = { enabled: false, minSavingsPercent: 100 };

let cachedDefaultSmartCrusherConfig: SmartCrusherFilterConfig | null = null;

function defaultSmartCrusherConfig(): SmartCrusherFilterConfig {
  if (cachedDefaultSmartCrusherConfig) return cachedDefaultSmartCrusherConfig;
  try {
    cachedDefaultSmartCrusherConfig = loadConfig().config.smartCrusher;
  } catch {
    cachedDefaultSmartCrusherConfig = SAFE_DISABLED_SMART_CRUSHER_CONFIG;
  }
  return cachedDefaultSmartCrusherConfig;
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

interface SmartCrusherAttempt {
  text: string;
  strategy: string;
  guard: GuardResult;
}

/**
 * Attempts SmartCrusher compression on `content` (a full JSON text — either
 * the top-level uniform array itself, or an arbitrary larger JSON document),
 * subject to the same mandatory measured-savings guard convention as TOON
 * (`evaluateGuard`, reused directly rather than reimplemented — see
 * `smartCrusher.minSavingsPercent`'s doc comment in `src/config/defaults.ts`
 * for why this is a separate config value from `toon.minSavingsPercent`).
 *
 * `rowCountForGuard` intentionally bypasses `evaluateGuard`'s own `minRows`
 * floor (by always passing a value that clears it): SmartCrusher's WASM
 * side already has its own internal minimum-items-to-analyze gate
 * (`min_items_to_analyze`, default 5 — see `crusher.rs`) that decides
 * whether it even attempts compression at all; a Node-side row-count
 * minimum here would just duplicate that gate, not add a new guarantee.
 * The measured-token-savings check below is the real, non-redundant guard.
 *
 * Returns `null` (never throws) whenever: the config disables it, the WASM
 * module isn't available, the input wasn't JSON/was too small to bother
 * (`strategy === "passthrough"` or any `"skip:*"`/`"unavailable:*"`
 * strategy — i.e. `!wasModified`), or the measured savings don't clear
 * `config.minSavingsPercent`.
 */
function trySmartCrusher(content: string, config: SmartCrusherFilterConfig): SmartCrusherAttempt | null {
  if (!config.enabled) return null;

  let result;
  try {
    result = smartCrush(content);
  } catch {
    // smart-crusher.ts's own compress() already fails open internally, but
    // this filter must never crash a hook regardless of what any dependency
    // does in the future — defense in depth, matching every other guarded
    // attempt in this file.
    return null;
  }

  if (!result.wasModified) return null; // "passthrough" or any "skip:*"/"unavailable:*" strategy

  const guard = evaluateGuard(content, result.compressed, Number.MAX_SAFE_INTEGER, {
    minSavingsPercent: config.minSavingsPercent,
    minRows: 0,
  });
  if (!guard.approved) return null;

  return { text: result.compressed, strategy: result.strategy, guard };
}

/**
 * Persists whatever `<<ccr:HASH ...>>` markers a SmartCrusher-compressed
 * result carries, so `optiflow ccr-retrieve <hash>` (`src/cli/commands/ccr-retrieve.ts`)
 * has something real to serve back. Never throws — `ccr-store.ts`'s
 * `putCcr` already swallows its own errors, but this function's call site
 * (right after a guard-approved SmartCrusher result) must stay
 * fail-open too.
 *
 * Storage strategy per hash (see `src/native/smart-crusher.ts`'s
 * `ccrMarkerHashFor` doc comment for the underlying evidence):
 *   - If the marker's hash byte-matches `sha256(JSON.stringify(parsedTopLevelValue))`
 *     — i.e. this marker refers to exactly the top-level value `compress()`
 *     was asked to crush, verified empirically to be headroom-core's own
 *     real hash input for that case — store those EXACT bytes. A retrieval
 *     is then PROVABLY the same content the marker's hash was computed
 *     from, not an approximation.
 *   - Otherwise (the marker refers to a nested sub-array or an opaque
 *     string blob hashed at some other point in the tree — headroom-core
 *     mints one hash per dropped sub-array/blob, and reproducing its exact
 *     recursive traversal on the Node side is out of this wiring's scope),
 *     fall back to storing the whole top-level ORIGINAL text. This is a
 *     deliberate, documented superset guarantee, not a bug: the dropped
 *     content is necessarily a subset of the original document, so
 *     retrieval always returns something that CONTAINS whatever was lost —
 *     satisfying CCR's "no data lost, retrievable" contract — even when it
 *     isn't the minimal exact excerpt.
 */
function storeCcrMarkers(originalText: string, parsedTopLevelValue: unknown, compressed: string): void {
  const hashes = extractCcrHashes(compressed);
  if (hashes.length === 0) return;

  let exactCanonical: string | null = null;
  let exactHash: string | null = null;
  try {
    exactCanonical = JSON.stringify(parsedTopLevelValue);
    exactHash = ccrMarkerHashFor(exactCanonical);
  } catch {
    // Non-serializable parsed value (shouldn't happen — it came from
    // JSON.parse — but this function must never throw regardless).
  }

  for (const hash of hashes) {
    if (exactHash !== null && hash === exactHash && exactCanonical !== null) {
      putCcr(hash, exactCanonical);
    } else {
      putCcr(hash, originalText);
    }
  }
}

/**
 * Attempts the JSON path. Returns `null` if `text` doesn't parse as JSON, so
 * the caller can fall through to the line-oriented heuristic.
 */
function tryJsonFilter(text: string, toonConfig: ToonConfig, smartCrusherConfig: SmartCrusherFilterConfig): FilterOutput | null {
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
    // savings — see toonAttempt.reason). Before falling back to the dumb
    // Phase-3 head+tail truncation, try SmartCrusher's smarter,
    // CCR-retrievable lossy sampling on the SAME array — see this file's
    // header comment for why this sits exactly here (between TOON and
    // truncation) in the decision chain.
    const smartCrusherAttempt = trySmartCrusher(trimmed, smartCrusherConfig);
    if (smartCrusherAttempt) {
      storeCcrMarkers(trimmed, parsed, smartCrusherAttempt.text);
      return {
        text: smartCrusherAttempt.text,
        formatHint: "uniform-json-array",
        meta: {
          itemCount: parsed.length,
          toon: { applied: false, reason: toonAttempt.reason },
          smartCrusher: { applied: true, strategy: smartCrusherAttempt.strategy, ...smartCrusherAttempt.guard },
        },
      };
    }

    // SmartCrusher also declined (disabled, WASM unavailable, or didn't
    // measurably help) — fall back to the Phase-3 head+tail truncation so
    // large arrays still shrink today even when neither smarter option
    // helps on this particular shape.
    const { value, omitted } = truncateUniformArray(parsed);
    return {
      text: JSON.stringify(value, null, 2),
      formatHint: "uniform-json-array",
      meta: {
        itemCount: parsed.length,
        omittedItems: omitted,
        toon: { applied: false, reason: toonAttempt.reason },
        smartCrusher: { applied: false },
      },
    };
  }

  // Any other JSON shape: never string-slice it directly (would break JSON
  // semantics) — but SmartCrusher's own re-serialization is JSON-safe by
  // construction (it parses, transforms the tree, re-serializes), so it's
  // tried here too before handing the value back verbatim. See this file's
  // header comment for the real evidence (`crusher.rs`'s
  // `smart_crush_content`) that this operates on arbitrary JSON, not just
  // uniform arrays.
  const smartCrusherAttempt = trySmartCrusher(trimmed, smartCrusherConfig);
  if (smartCrusherAttempt) {
    storeCcrMarkers(trimmed, parsed, smartCrusherAttempt.text);
    return {
      text: smartCrusherAttempt.text,
      formatHint: "json",
      meta: {
        smartCrusher: { applied: true, strategy: smartCrusherAttempt.strategy, ...smartCrusherAttempt.guard },
      },
    };
  }

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
  /**
   * The `smartCrusher` config section to use for the SmartCrusher-compression
   * attempt (see this file's header comment for exactly where it sits in
   * the decision chain). Defaults to the resolved `optiflow.config.json`'s
   * `smartCrusher` section (loaded at most once per process). Tests should
   * always pass this explicitly rather than relying on whatever config
   * happens to be on disk.
   */
  smartCrusherConfig?: SmartCrusherFilterConfig;
}

/** Generic fallback filter: JSON-aware (TOON- and SmartCrusher-aware), otherwise line-oriented head+tail truncation. */
export function genericFilter(input: FilterInput, options: GenericFilterOptions = {}): FilterOutput {
  const toonConfig = options.toonConfig ?? defaultToonConfig();
  const smartCrusherConfig = options.smartCrusherConfig ?? defaultSmartCrusherConfig();
  const jsonResult = tryJsonFilter(input.stdout, toonConfig, smartCrusherConfig);
  if (jsonResult) return jsonResult;

  const { text, truncated, omitted } = truncateLogLines(input.stdout);
  return {
    text,
    formatHint: truncated ? "log" : "plain",
    ...(truncated ? { meta: { omittedLines: omitted } } : {}),
  };
}
