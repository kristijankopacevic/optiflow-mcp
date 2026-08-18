// Kompress ONNX model cache/download management.
//
// Model: chopratejas/kompress-v2-base (Apache-2.0 license — commercial use
// permitted, compatible with optiflow's MIT), pinned to commit
// b1563631b35bfdcee37587ad530147497d820d4c. That's the exact SHA
// `vendor/headroom/headroom/onnx_runtime.py`'s `_PINNED_REVISIONS` dict pins
// for this repo (as of 2026-06-10 per that file's own comment) — reused here
// verbatim for the same supply-chain reason headroom states: an immutable
// commit SHA means a changed/compromised upstream repo cannot be pulled
// silently. To upgrade, bump `KOMPRESS_PINNED_REVISION` deliberately.
//
// Two ONNX artifact variants are published in the repo's `onnx/` subdir:
// `kompress-int8-wo.onnx` (weight-only int8, ~274MB — the default here) and
// `kompress-fp32.onnx` (~601MB, lossless reference). See
// `vendor/headroom/headroom/transforms/kompress_compressor.py`'s comment
// (around its `_DEFAULT_ONNX_FILENAMES` constant) for the accuracy/size
// tradeoff those numbers are based on (f1 0.9130 vs 0.9128, 2.2x less
// memory) — the same tradeoff this port makes, deliberately.
//
// Deliberately download-on-first-use, never bundled in the npm package or
// git repo: 274MB is far too large for either. `ensureModelDownloaded`
// requires an explicit `allowDownload: true` from the caller — a cache miss
// with `allowDownload` unset/false returns `{ available: false, reason }`
// without ever touching the network, matching this feature's "opt-in,
// gracefully-degrading" contract (see `src/native/kompress.ts`).
//
// Every filesystem write here is atomic (temp file + rename), mirroring
// `src/install/settings-writer.ts`'s `atomicWriteFile` pattern — but
// binary-safe (that helper writes strings via `"utf8"`, which would corrupt
// a binary `.onnx` file) and streamed rather than buffered whole into
// memory, since the artifact is hundreds of megabytes.

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getOptiflowHome } from "../core/paths.js";

/** HuggingFace Hub repository holding the Kompress v2 model artifacts. */
export const KOMPRESS_HF_REPO = "chopratejas/kompress-v2-base";

/**
 * Immutable commit SHA this module resolves all downloads against — see the
 * module doc comment above for why this is pinned rather than a floating
 * ref, and where the SHA comes from.
 */
export const KOMPRESS_PINNED_REVISION = "b1563631b35bfdcee37587ad530147497d820d4c";

export type KompressVariant = "int8" | "fp32";

const ONNX_REPO_PATHS: Record<KompressVariant, string> = {
  int8: "onnx/kompress-int8-wo.onnx",
  fp32: "onnx/kompress-fp32.onnx",
};

const ONNX_LOCAL_FILENAMES: Record<KompressVariant, string> = {
  int8: "kompress-int8-wo.onnx",
  fp32: "kompress-fp32.onnx",
};

/**
 * Tokenizer files live at the repo root (not under `onnx/`) — same files
 * `AutoTokenizer.from_pretrained` expects to find in a local directory.
 */
const TOKENIZER_REPO_FILENAMES = [
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
] as const;

/**
 * Minimal shape this module needs from `fetch`'s `Response` — narrow enough
 * that tests can hand-build a fake without constructing a real `Response`,
 * but still structurally satisfied by the real global `fetch`.
 */
export interface KompressFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

export type KompressFetch = (url: string) => Promise<KompressFetchResponse>;

export interface EnsureModelDownloadedOptions {
  /**
   * Must be explicitly `true` to allow a network download on a cache miss.
   * Defaults to `false` — a cache miss without this returns
   * `{ available: false, reason }`, never fetches.
   */
  allowDownload?: boolean;
  /** Which ONNX artifact to resolve. Defaults to `"int8"`. */
  variant?: KompressVariant;
  /** Overrides the cache home directory (defaults to `getOptiflowHome()`). */
  home?: string;
  /** Injectable fetch implementation, for tests. Defaults to global `fetch`. */
  fetchImpl?: KompressFetch;
}

export type EnsureModelDownloadedResult =
  | {
      available: true;
      onnxPath: string;
      tokenizerDir: string;
      /** Whether every file was already present locally (no download happened). */
      cached: boolean;
      variant: KompressVariant;
    }
  | { available: false; reason: string };

function cacheRoot(home: string): string {
  return path.join(home, "models", "kompress");
}

function onnxLocalPath(home: string, variant: KompressVariant): string {
  return path.join(cacheRoot(home), ONNX_LOCAL_FILENAMES[variant]);
}

function tokenizerDirPath(home: string): string {
  return path.join(cacheRoot(home), "tokenizer");
}

function metaPath(filePath: string): string {
  return `${filePath}.optiflow-meta.json`;
}

interface DownloadMeta {
  bytes: number;
  url: string;
}

function readMeta(filePath: string): DownloadMeta | null {
  try {
    const raw = readFileSync(metaPath(filePath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as DownloadMeta).bytes === "number"
    ) {
      return parsed as DownloadMeta;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True if `filePath` exists and, when we have a sidecar metadata file
 * recording the expected byte count from when *this module* downloaded it,
 * the on-disk size still matches. A file with no sidecar (e.g. manually
 * placed by an operator) is trusted on existence alone — this is a cheap
 * integrity check against a crashed download from this module, not a
 * general-purpose corruption detector.
 */
function isFileValidCached(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const meta = readMeta(filePath);
  if (!meta) return true;
  try {
    return statSync(filePath).size === meta.bytes;
  } catch {
    return false;
  }
}

function hfResolveUrl(repoPath: string): string {
  return `https://huggingface.co/${KOMPRESS_HF_REPO}/resolve/${KOMPRESS_PINNED_REVISION}/${repoPath}`;
}

export type DownloadFileResult =
  | { ok: true; bytes: number }
  | { ok: false; error: string };

/**
 * Downloads `url` to `destPath` atomically: streamed into a temp file in the
 * same directory, size-validated against the response's `Content-Length`
 * (when present) before the rename, so a crashed/interrupted download never
 * leaves a truncated file that a later run's cache check mistakes for
 * valid. On any failure the temp file is removed and `destPath` is left
 * completely untouched. Never throws — every failure mode is reported via
 * the returned `{ ok: false, error }`.
 */
async function downloadFileAtomic(
  url: string,
  destPath: string,
  fetchImpl: KompressFetch
): Promise<DownloadFileResult> {
  const dir = path.dirname(destPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(destPath)}.optiflow-tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );

  let response: KompressFetchResponse;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    return { ok: false, error: `network error fetching ${url}: ${(err as Error).message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `download failed: ${url} returned HTTP ${response.status}` };
  }
  if (!response.body) {
    return { ok: false, error: `download failed: ${url} returned no response body` };
  }

  const contentLengthHeader = response.headers.get("content-length");
  const expectedBytes =
    contentLengthHeader !== null ? Number.parseInt(contentLengthHeader, 10) : undefined;

  try {
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tempPath));
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup; the stream failure itself is the real error.
    }
    return { ok: false, error: `download stream failed for ${url}: ${(err as Error).message}` };
  }

  let actualBytes: number;
  try {
    actualBytes = statSync(tempPath).size;
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort.
    }
    return {
      ok: false,
      error: `could not stat downloaded temp file for ${url}: ${(err as Error).message}`,
    };
  }

  if (expectedBytes !== undefined && Number.isFinite(expectedBytes) && actualBytes !== expectedBytes) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort.
    }
    return {
      ok: false,
      error: `download size mismatch for ${url}: expected ${expectedBytes} bytes, got ${actualBytes}`,
    };
  }

  try {
    renameSync(tempPath, destPath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort.
    }
    return { ok: false, error: `could not finalize download for ${url}: ${(err as Error).message}` };
  }

  try {
    const meta: DownloadMeta = { bytes: actualBytes, url };
    writeFileSync(metaPath(destPath), JSON.stringify(meta), "utf8");
  } catch {
    // Sidecar metadata is best-effort insurance, not required for
    // correctness — the cached file itself is already valid at this point.
  }

  return { ok: true, bytes: actualBytes };
}

/**
 * Ensures the Kompress ONNX model + tokenizer files are present in the
 * local cache, returning their paths. Never downloads unless `allowDownload`
 * is explicitly `true` — with it unset/false, a cache miss returns
 * `{ available: false, reason }` without ever calling `fetchImpl`.
 *
 * Downloads (when allowed) happen sequentially: the ONNX artifact first
 * (largest, most likely to fail/be slow), then any missing tokenizer files.
 * A failure at any step returns immediately without throwing.
 */
export async function ensureModelDownloaded(
  options: EnsureModelDownloadedOptions = {}
): Promise<EnsureModelDownloadedResult> {
  const home = options.home ?? getOptiflowHome();
  const variant = options.variant ?? "int8";
  const allowDownload = options.allowDownload ?? false;
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as KompressFetch);

  const onnxPath = onnxLocalPath(home, variant);
  const tokDir = tokenizerDirPath(home);
  const tokenizerPaths = TOKENIZER_REPO_FILENAMES.map((f) => path.join(tokDir, f));

  const missing = [onnxPath, ...tokenizerPaths].filter((p) => !isFileValidCached(p));

  if (missing.length === 0) {
    return { available: true, onnxPath, tokenizerDir: tokDir, cached: true, variant };
  }

  if (!allowDownload) {
    return {
      available: false,
      reason:
        `Kompress model not cached locally (missing: ${missing
          .map((p) => path.basename(p))
          .join(", ")}) and allowDownload is false — set kompress.allowDownload: true ` +
        `to permit a one-time ~274MB download from HuggingFace.`,
    };
  }

  if (!isFileValidCached(onnxPath)) {
    const result = await downloadFileAtomic(
      hfResolveUrl(ONNX_REPO_PATHS[variant]),
      onnxPath,
      fetchImpl
    );
    if (!result.ok) return { available: false, reason: result.error };
  }

  for (const filename of TOKENIZER_REPO_FILENAMES) {
    const dest = path.join(tokDir, filename);
    if (isFileValidCached(dest)) continue;
    const result = await downloadFileAtomic(hfResolveUrl(filename), dest, fetchImpl);
    if (!result.ok) return { available: false, reason: result.error };
  }

  return { available: true, onnxPath, tokenizerDir: tokDir, cached: false, variant };
}
