// Token counting. `countTokens`/`estimateTokens` stay synchronous and
// dependency-free by default, because this module is imported on the
// statusline hot path (<100ms budget, see plan Module 3) as well as from
// CLI/report code where a heavier dependency would be fine. `tiktoken` is
// deliberately NOT a dependency of this package today; the hooks below just
// leave room for a future optional dependency to plug in without changing
// any call site.

interface TokenEncoder {
  encode(text: string): { length: number };
}

let encoder: TokenEncoder | null = null;
let initAttempted = false;

/**
 * Best-effort, one-time attempt to load a real tokenizer (`tiktoken`) if
 * it's installed. Uses an indirect import specifier (a variable, not a
 * string literal) so neither `tsc` nor esbuild tries to statically resolve
 * a package that isn't a declared dependency — a literal
 * `import("tiktoken")` would fail `tsc --noEmit` ("cannot find module") and
 * would make esbuild's bundler try (and fail) to inline it.
 *
 * Callers do not need to await this for `countTokens` to work — it always
 * has the heuristic fallback — but calling it first lets a future optional
 * `tiktoken` dependency upgrade counting accuracy transparently.
 */
export async function initTokenizer(): Promise<boolean> {
  if (initAttempted) return encoder !== null;
  initAttempted = true;
  try {
    const specifier = "tiktoken";
    const mod: any = await import(specifier);
    const getEncoding = mod.get_encoding ?? mod.default?.get_encoding;
    if (typeof getEncoding === "function") {
      encoder = getEncoding("cl100k_base") as TokenEncoder;
    }
  } catch {
    encoder = null;
  }
  return encoder !== null;
}

/**
 * Counts tokens in `text`. Uses a real tokenizer if `initTokenizer()` was
 * previously called and succeeded; otherwise falls back to the standard
 * rough heuristic of ~4 characters per token. This is an APPROXIMATION, not
 * an exact count — real tokenization varies substantially with content
 * (code, non-Latin scripts, and whitespace/JSON-heavy text all skew the
 * chars-per-token ratio away from 4).
 */
export function countTokens(text: string): number {
  if (encoder) {
    try {
      return encoder.encode(text).length;
    } catch {
      // Fall through to the heuristic if the encoder throws.
    }
  }
  return Math.ceil(text.length / 4);
}

/**
 * Same rough ~4-bytes-per-token approximation, for cases where only a byte
 * length is known (e.g. a streamed/binary payload size) and the actual text
 * isn't available to tokenize.
 */
export function estimateTokens(byteLength: number): number {
  return Math.ceil(byteLength / 4);
}
