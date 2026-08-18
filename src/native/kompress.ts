// Kompress: TS-native reimplementation of headroom's ModernBERT
// token-classification compressor, running directly against
// `onnxruntime-node` + `@huggingface/transformers`'s tokenizer — no
// headroom-core Rust `ml` feature, no Python. Per the plan's Phase 4 locked
// decision: "Kompress ONNX port reimplemented directly in Node ... bypassing
// headroom-core's Rust `ml` feature entirely."
//
// Primary reference:
// `vendor/headroom/headroom/transforms/kompress_compressor.py`'s
// `KompressCompressor.compress` (the real per-chunk algorithm) and
// `vendor/headroom/headroom/onnx_runtime.py` (model repo/pinned revision,
// consumed by `./kompress-model.ts`).
//
// ── Scope vs. the Python reference (deliberate, not accidental) ──────────
//
// The production Python module also implements: batching across multiple
// texts, per-backend execution semaphores, a startup latency canary,
// a consecutive-failure degrade latch, and background download threads —
// all concerns of a long-lived multi-tenant proxy process serving many
// concurrent requests. optiflow compresses one hook's output at a time in a
// short-lived CLI process; none of that infrastructure applies here. Only
// the actual compression algorithm is ported: whitespace-word chunking
// (`chunk_words`), the must-keep regex override, the score-threshold keep
// decision, and word-index reassembly.
//
// ── Tokenizer API note (verified empirically against the installed
//    package, not assumed — package APIs are known to have changed
//    non-trivially across the JS/Python transformers split) ───────────────
//
// `@huggingface/transformers@4.2.0`'s `PreTrainedTokenizer` has no
// `is_split_into_words` / `word_ids()` (confirmed by reading its installed
// `.d.ts` — neither symbol appears anywhere in the package). That's the
// mechanism the Python reference depends on to map ONNX output positions
// back to the caller's pre-split words. This module reconstructs the same
// mapping itself instead: each word in a chunk is encoded individually with
// `add_special_tokens: false`, and every resulting sub-token id is tagged
// with that word's index before all words' ids are concatenated — exactly
// what `is_split_into_words=True` does internally in a Python fast
// tokenizer. The model's CLS/SEP-equivalent special-token wrapping is
// detected generically (`detectSpecialWrapping`, by diffing a probe encode
// with/without `add_special_tokens`) rather than assuming ModernBERT uses
// BERT's literal `cls_token`/`sep_token` config keys.
//
// This is an approximation of Python's fast-tokenizer word-splitting, not a
// byte-for-byte port — the gate for this module is "sane output on a test
// input" (per the plan's Phase 4 gate), not exact numerical parity with the
// Python reference.

import type { AutoTokenizer } from "@huggingface/transformers";
import type { PreTrainedTokenizer } from "@huggingface/transformers";
import type { InferenceSession, Tensor } from "onnxruntime-node";
import type { KompressFetch, KompressVariant } from "./kompress-model.js";
import { ensureModelDownloaded } from "./kompress-model.js";

/**
 * `onnxruntime-node` and `@huggingface/transformers` (which itself vendors
 * its own nested `onnxruntime-node`-shaped native binding) both hit the same
 * class of problem as `better-sqlite3` (see `core/cache-engine.ts`'s header
 * comment): a native `.node` addon that isn't guaranteed to be present in a
 * real marketplace install. `compressWithKompress` below is only ever
 * reached when `kompress.enabled === true` (defaults `false`), but a STATIC
 * top-level `import` still poisons the whole ESM module graph regardless of
 * that flag, since Node resolves the entire static import graph before
 * running any code -- crashing every one of the 76 `smart_*` tools at
 * process start, not just the ones that use Kompress.
 *
 * Every real call site here is already async (`compressWithKompress` and
 * everything it calls), so both packages are loaded via a real awaited
 * `import()`, deferred until `loadModelUncached`'s first real use, memoized
 * (success AND failure) at module scope. A load failure surfaces as the
 * exact same `{ error: string }` shape `loadModelUncached` already uses for
 * an ONNX-session/tokenizer load failure -- `compressWithKompress` already
 * turns that into `{ available: false, reason }` rather than throwing, and
 * `smart-read.ts` already treats any Kompress failure (including a thrown
 * exception, via its own try/catch) as "fall through to the next
 * compression strategy" -- verified by reading that call site, not assumed.
 */
type OnnxRuntimeModule = typeof import("onnxruntime-node");
type TransformersModule = typeof import("@huggingface/transformers");

let onnxRuntimeLoadPromise: Promise<OnnxRuntimeModule> | null = null;
let transformersLoadPromise: Promise<TransformersModule> | null = null;

function loadOnnxRuntime(): Promise<OnnxRuntimeModule> {
  if (!onnxRuntimeLoadPromise) {
    onnxRuntimeLoadPromise = import("onnxruntime-node").catch((err) => {
      // Don't memoize a failure -- a later call (e.g. after the caller
      // installs the optional dependency) gets to retry, matching
      // `modelCache`'s own "never cache a failed load" precedent below.
      onnxRuntimeLoadPromise = null;
      throw err;
    });
  }
  return onnxRuntimeLoadPromise;
}

function loadTransformers(): Promise<TransformersModule> {
  if (!transformersLoadPromise) {
    transformersLoadPromise = import("@huggingface/transformers").catch(
      (err) => {
        transformersLoadPromise = null;
        throw err;
      }
    );
  }
  return transformersLoadPromise;
}

/**
 * Mirrors `vendor/headroom/headroom/transforms/kompress_compressor.py`'s
 * `_KOMPRESS_MUST_KEEP_RE` exactly: tokens matching this pattern are always
 * kept regardless of the model's score. Numbers, ALLCAPS identifiers,
 * dotted paths, unix paths, file extensions, CLI flags, and CamelCase names
 * carry semantic meaning that can't be reconstructed from context once
 * dropped.
 */
const MUST_KEEP_RE =
  /\b0x[0-9A-Fa-f]+\b|(?<![\w.])\d+(?:\.\d+)?(?![\w.])|[A-Z_]{2,}|[a-z_][a-z0-9_]*\.[a-z0-9_]+|\/[a-z0-9/._-]{2,}|\.[a-z]{2,4}\b|--?[a-z][\w-]*|\b[A-Z][a-z]+[A-Z]\w*/;

const DEFAULT_CHUNK_WORDS = 350;
const DEFAULT_SCORE_THRESHOLD = 0.5;
const DEFAULT_MAX_LENGTH = 512;
const MIN_WORDS_FOR_COMPRESSION = 10;

export interface KompressOptions {
  /** Master on/off switch. Defaults to `false` (opt-in feature). */
  enabled?: boolean;
  /** Forwarded to `ensureModelDownloaded` — see that module's docs. Defaults to `false`. */
  allowDownload?: boolean;
  /** Which ONNX artifact variant to use. Defaults to `"int8"`. */
  variant?: KompressVariant;
  /** Overrides the model cache home directory (tests only). */
  home?: string;
  /** Injectable fetch implementation (tests only). */
  fetchImpl?: KompressFetch;
  /** Words per inference chunk. Defaults to 350 (matches the trained model). */
  chunkWords?: number;
  /** Per-token keep threshold on the model's [0,1] score. Defaults to 0.5. */
  scoreThreshold?: number;
  /** Max tokens per chunk fed to the model (including special tokens). Defaults to 512. */
  maxLength?: number;
}

export type KompressCompressResult =
  | {
      available: true;
      compressed: string;
      original: string;
      originalTokens: number;
      compressedTokens: number;
      compressionRatio: number;
    }
  | { available: false; reason: string };

interface LoadedModel {
  session: InferenceSession;
  tokenizer: PreTrainedTokenizer;
  specialPrefix: number[];
  specialSuffix: number[];
  /** The lazily-loaded module's `Tensor` constructor, for use in the main compress loop below. */
  Tensor: OnnxRuntimeModule["Tensor"];
}

// Cached by `<onnxPath>::<tokenizerDir>` so repeated calls against the same
// cached model don't reload the session/tokenizer every time. A failed load
// is never cached — a later call gets to retry (e.g. after the caller fixes
// a permissions problem) rather than being permanently stuck on one bad
// attempt for the life of the process.
const modelCache = new Map<string, Promise<LoadedModel | { error: string }>>();

function cacheKeyFor(onnxPath: string, tokenizerDir: string): string {
  return `${onnxPath}::${tokenizerDir}`;
}

/**
 * Detects the model's special-token wrapping (CLS/SEP-equivalent prefix and
 * suffix ids) generically, by diffing a probe word encoded with and without
 * `add_special_tokens`. Avoids hardcoding ModernBERT-specific token names —
 * see the module doc comment.
 */
function detectSpecialWrapping(tokenizer: PreTrainedTokenizer): {
  prefix: number[];
  suffix: number[];
} {
  const probe = "x";
  const withSpecial = tokenizer.encode(probe, { add_special_tokens: true });
  const withoutSpecial = tokenizer.encode(probe, { add_special_tokens: false });

  if (withoutSpecial.length === 0 || withSpecial.length < withoutSpecial.length) {
    return { prefix: [], suffix: [] };
  }

  for (let start = 0; start <= withSpecial.length - withoutSpecial.length; start++) {
    let matches = true;
    for (let i = 0; i < withoutSpecial.length; i++) {
      if (withSpecial[start + i] !== withoutSpecial[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return {
        prefix: withSpecial.slice(0, start),
        suffix: withSpecial.slice(start + withoutSpecial.length),
      };
    }
  }
  // Couldn't find the probe's ids inside the special-wrapped encoding (an
  // unexpected tokenizer shape) — fail safe to "no wrapping" rather than
  // guessing; inference still runs, just without CLS/SEP-equivalent tokens.
  return { prefix: [], suffix: [] };
}

async function loadModelUncached(
  onnxPath: string,
  tokenizerDir: string
): Promise<LoadedModel | { error: string }> {
  let onnxruntime: OnnxRuntimeModule;
  let transformers: TransformersModule;
  try {
    [onnxruntime, transformers] = await Promise.all([
      loadOnnxRuntime(),
      loadTransformers(),
    ]);
  } catch (err) {
    return {
      error:
        `Kompress dependencies unavailable (onnxruntime-node/@huggingface/transformers not ` +
        `installed, or failed to load): ${(err as Error).message}`,
    };
  }

  let session: InferenceSession;
  try {
    session = await onnxruntime.InferenceSession.create(onnxPath);
  } catch (err) {
    return { error: `Kompress ONNX session failed to load from ${onnxPath}: ${(err as Error).message}` };
  }

  // Smoke-run: mirrors `vendor/headroom/headroom/transforms/kompress_compressor.py`'s
  // `_smoke_run`. The int8 weight-only artifact's `MatMulNBits` op can be
  // *accepted* at session construction and only fail at `run()`, on an
  // onnxruntime build without an 8-bit kernel (that upstream comment
  // documents 207 consecutive silent per-request failures from exactly this
  // gap). Running two tokens through the real graph here means a broken
  // artifact is reported once, as "unusable", instead of throwing out of
  // every real `compressWithKompress` call.
  try {
    await session.run({
      input_ids: new onnxruntime.Tensor("int64", BigInt64Array.from([0n, 0n]), [1, 2]),
      attention_mask: new onnxruntime.Tensor("int64", BigInt64Array.from([1n, 1n]), [1, 2]),
    });
  } catch (err) {
    return {
      error:
        `Kompress ONNX model failed its smoke-run at ${onnxPath} (likely an unsupported ` +
        `int8/MatMulNBits kernel on this platform's onnxruntime build): ${(err as Error).message}`,
    };
  }

  let tokenizer: PreTrainedTokenizer;
  try {
    tokenizer = await transformers.AutoTokenizer.from_pretrained(tokenizerDir, { local_files_only: true });
  } catch (err) {
    return {
      error: `Kompress tokenizer failed to load from ${tokenizerDir}: ${(err as Error).message}`,
    };
  }

  const { prefix, suffix } = detectSpecialWrapping(tokenizer);
  return {
    session,
    tokenizer,
    specialPrefix: prefix,
    specialSuffix: suffix,
    Tensor: onnxruntime.Tensor,
  };
}

async function getLoadedModel(
  onnxPath: string,
  tokenizerDir: string
): Promise<LoadedModel | { error: string }> {
  const key = cacheKeyFor(onnxPath, tokenizerDir);
  let cached = modelCache.get(key);
  if (!cached) {
    cached = loadModelUncached(onnxPath, tokenizerDir);
    modelCache.set(key, cached);
  }
  const result = await cached;
  if ("error" in result) {
    modelCache.delete(key);
  }
  return result;
}

interface ChunkEncoding {
  inputIds: number[];
  attentionMask: number[];
  /** Same length as `inputIds`; `null` at special-token positions. */
  wordIds: Array<number | null>;
}

/**
 * Builds one chunk's model input by encoding each word individually
 * (`add_special_tokens: false`) and tagging every resulting sub-token id
 * with that word's index — the manual equivalent of Python's
 * `is_split_into_words=True` + `word_ids()`. Wraps with the model's
 * detected special-token prefix/suffix, then truncates to `maxLength`,
 * preserving the suffix (mirrors a fast tokenizer's default single-sequence
 * truncation, which drops from the end of the *content*, not the trailing
 * special token).
 *
 * Words dropped by truncation get no token position at all, so they are
 * silently excluded from the keep-decision for this chunk (the must-keep
 * override below still applies to them by word text, independent of
 * whether they survived truncation, since it runs over `chunkWords`
 * directly) — this mirrors the Python reference's own truncation behavior
 * (`max_length=512` there too), not a bug introduced by this port.
 */
function buildChunkEncoding(
  tokenizer: PreTrainedTokenizer,
  specialPrefix: readonly number[],
  specialSuffix: readonly number[],
  chunkWords: readonly string[],
  maxLength: number
): ChunkEncoding {
  const ids: number[] = [...specialPrefix];
  const wordIds: Array<number | null> = specialPrefix.map(() => null);

  for (let w = 0; w < chunkWords.length; w++) {
    const subIds = tokenizer.encode(chunkWords[w], { add_special_tokens: false });
    for (const id of subIds) {
      ids.push(id);
      wordIds.push(w);
    }
  }

  for (const id of specialSuffix) {
    ids.push(id);
    wordIds.push(null);
  }

  let truncatedIds = ids;
  let truncatedWordIds = wordIds;
  if (ids.length > maxLength && maxLength > specialSuffix.length) {
    const keepSuffix = specialSuffix.length;
    const keepHead = maxLength - keepSuffix;
    truncatedIds = [...ids.slice(0, keepHead), ...ids.slice(ids.length - keepSuffix)];
    truncatedWordIds = [...wordIds.slice(0, keepHead), ...wordIds.slice(wordIds.length - keepSuffix)];
  } else if (ids.length > maxLength) {
    // maxLength smaller than the suffix itself — degenerate config; just
    // hard-truncate from the front rather than producing a negative slice.
    truncatedIds = ids.slice(0, maxLength);
    truncatedWordIds = wordIds.slice(0, maxLength);
  }

  return {
    inputIds: truncatedIds,
    attentionMask: truncatedIds.map(() => 1),
    wordIds: truncatedWordIds,
  };
}

/** Applies the must-keep override in place. Mirrors `_add_kompress_must_keep_words`. */
function addMustKeepWords(
  keptIds: Set<number>,
  chunkWords: readonly string[],
  chunkStart: number
): void {
  for (let i = 0; i < chunkWords.length; i++) {
    if (MUST_KEEP_RE.test(chunkWords[i])) {
      keptIds.add(i + chunkStart);
    }
  }
}

/**
 * Compresses `text` using the real Kompress ONNX model: word-level
 * keep/discard decisions from a ModernBERT token-classification head,
 * chunked at `chunkWords`-word boundaries, with a must-keep regex override
 * for semantically fragile tokens (numbers, paths, flags, etc).
 *
 * Never throws. Returns `{ available: false, reason }` — distinctly worded
 * per cause — for each of: the feature disabled (`enabled` unset/false),
 * input too short to bother (`< 10` words, matching the Python reference),
 * the model not cached with downloading not allowed, a download failure,
 * or an ONNX/tokenizer load or inference failure. Returns
 * `{ available: true, ... }` whenever real inference actually ran,
 * including the (rare) case where the model's keep-set came back empty —
 * that case passes through `text` unmodified (ratio 1.0) rather than
 * returning an empty compressed string, mirroring the Python reference's
 * own passthrough behavior for a low-signal result.
 */
export async function compressWithKompress(
  text: string,
  options: KompressOptions = {}
): Promise<KompressCompressResult> {
  if (!(options.enabled ?? false)) {
    return { available: false, reason: "Kompress is disabled (config: kompress.enabled=false)" };
  }

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const nWords = words.length;
  if (nWords < MIN_WORDS_FOR_COMPRESSION) {
    return {
      available: false,
      reason: `input too short for Kompress (${nWords} words, need >= ${MIN_WORDS_FOR_COMPRESSION})`,
    };
  }

  const variant = options.variant ?? "int8";
  const modelInfo = await ensureModelDownloaded({
    allowDownload: options.allowDownload ?? false,
    variant,
    home: options.home,
    fetchImpl: options.fetchImpl,
  });
  if (!modelInfo.available) {
    return { available: false, reason: modelInfo.reason };
  }

  const loaded = await getLoadedModel(modelInfo.onnxPath, modelInfo.tokenizerDir);
  if ("error" in loaded) {
    return { available: false, reason: loaded.error };
  }

  const chunkWordsCount = options.chunkWords ?? DEFAULT_CHUNK_WORDS;
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;

  const keptIds = new Set<number>();

  try {
    for (let chunkStart = 0; chunkStart < nWords; chunkStart += chunkWordsCount) {
      const chunkWords = words.slice(chunkStart, chunkStart + chunkWordsCount);
      const { inputIds, attentionMask, wordIds } = buildChunkEncoding(
        loaded.tokenizer,
        loaded.specialPrefix,
        loaded.specialSuffix,
        chunkWords,
        maxLength
      );

      const feeds = {
        input_ids: new loaded.Tensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]),
        attention_mask: new loaded.Tensor(
          "int64",
          BigInt64Array.from(attentionMask.map(BigInt)),
          [1, attentionMask.length]
        ),
      };

      const results = await loaded.session.run(feeds);
      const scoresTensor = results.final_scores;
      if (!scoresTensor) {
        return {
          available: false,
          reason: `Kompress model output missing 'final_scores' (got: ${Object.keys(results).join(", ")})`,
        };
      }
      const scores = scoresTensor.data as unknown as ArrayLike<number>;

      for (let i = 0; i < wordIds.length; i++) {
        const wid = wordIds[i];
        if (wid === null) continue;
        if (Number(scores[i]) > scoreThreshold) {
          keptIds.add(wid + chunkStart);
        }
      }

      addMustKeepWords(keptIds, chunkWords, chunkStart);
    }
  } catch (err) {
    return { available: false, reason: `Kompress inference failed: ${(err as Error).message}` };
  }

  if (keptIds.size === 0) {
    // Real inference ran but produced no keep decisions at all (a
    // low-signal/degenerate result) — pass through unmodified rather than
    // returning an empty string. Mirrors the Python reference's own
    // `_passthrough` fallback for this case.
    return {
      available: true,
      compressed: text,
      original: text,
      originalTokens: nWords,
      compressedTokens: nWords,
      compressionRatio: 1.0,
    };
  }

  const compressedWords = [...keptIds]
    .filter((w) => w >= 0 && w < nWords)
    .sort((a, b) => a - b)
    .map((w) => words[w]);
  const compressed = compressedWords.join(" ");
  const compressedTokens = compressedWords.length;

  return {
    available: true,
    compressed,
    original: text,
    originalTokens: nWords,
    compressedTokens,
    compressionRatio: compressedTokens / nWords,
  };
}
