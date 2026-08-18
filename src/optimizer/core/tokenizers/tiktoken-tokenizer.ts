import { createHash } from 'crypto';
import type { Tiktoken, TiktokenModel } from 'tiktoken';
import { ITokenizer } from './i-tokenizer.js';
import { HeuristicTokenizer } from './heuristic-tokenizer.js';
import { LruCache } from '../../utils/lru-cache.js';

/**
 * `tiktoken` ships a native WASM loader (see esbuild.config.mjs's
 * `nativeExternals` doc comment) and is not guaranteed to be present in a
 * real marketplace install (Claude Code's automatic `npm ci --ignore-scripts`
 * never ships with a real install and can't run install scripts anyway).
 * A static top-level `import` of it would fail Node's ESM module-graph
 * resolution at process start for every caller of this file, even ones that
 * never construct a `TiktokenTokenizer` -- so the load is deferred to first
 * real use (see `loadTiktoken`/`ensureEncoder` below) and any failure
 * degrades to `HeuristicTokenizer` rather than throwing.
 */
type TiktokenModuleShape = typeof import('tiktoken');

let tiktokenLoadPromise: Promise<TiktokenModuleShape | null> | null = null;
let warnedTiktokenUnavailable = false;

function warnTiktokenUnavailableOnce(err: unknown): void {
  if (warnedTiktokenUnavailable) return;
  warnedTiktokenUnavailable = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    `[optiflow] tiktoken is unavailable (${message}) -- falling back to heuristic token counting. ` +
      `This is expected in a marketplace install without a manual "npm install tiktoken" and does not affect correctness of other tools.`
  );
}

async function loadTiktoken(): Promise<TiktokenModuleShape | null> {
  if (!tiktokenLoadPromise) {
    tiktokenLoadPromise = import('tiktoken').catch((err: unknown) => {
      warnTiktokenUnavailableOnce(err);
      return null;
    });
  }
  return tiktokenLoadPromise;
}

const DEFAULT_CACHE_SIZE = 500;
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
/**
 * Strings longer than this are hashed before being used as a cache key
 * so the LRU stores ~64-byte SHA-256 digests instead of entire prompts
 * or file contents — keeps the cache from ballooning into hundreds of
 * MB on hot paths.
 */
const KEY_HASH_THRESHOLD_CHARS = 256;

function cacheKeyFor(text: string): string {
  if (text.length <= KEY_HASH_THRESHOLD_CHARS) {
    return text;
  }
  return createHash('sha256').update(text).digest('hex');
}

const SUPPORTED_TIKTOKEN_MODELS: readonly TiktokenModel[] = [
  'gpt-4',
  'gpt-3.5-turbo',
];

export class TiktokenTokenizer implements ITokenizer {
  public readonly modelName: string;
  private readonly cache: LruCache<string, number>;
  private encoder: Tiktoken | null = null;
  /** Set once `ensureEncoder()` determines tiktoken can't be used. */
  private fallback: HeuristicTokenizer | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(modelName: string, cache?: LruCache<string, number>) {
    this.modelName = modelName;
    this.cache =
      cache ??
      new LruCache<string, number>(DEFAULT_CACHE_SIZE, DEFAULT_CACHE_TTL_MS);
  }

  /**
   * Lazily loads tiktoken and constructs the real encoder on first use.
   * Idempotent and memoized (via `initPromise`) so concurrent `countTokens`
   * calls don't race to load/construct twice. On any failure -- tiktoken
   * missing, or `encoding_for_model` throwing for any reason -- delegates
   * permanently to a `HeuristicTokenizer` for this instance.
   */
  private ensureEncoder(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const tiktoken = await loadTiktoken();
        if (!tiktoken) {
          this.fallback = new HeuristicTokenizer(this.modelName, this.cache);
          return;
        }
        try {
          const tiktokenModel = TiktokenTokenizer.mapToTiktokenModel(
            this.modelName
          );
          this.encoder = tiktoken.encoding_for_model(tiktokenModel);
        } catch (err) {
          warnTiktokenUnavailableOnce(err);
          this.fallback = new HeuristicTokenizer(this.modelName, this.cache);
        }
      })();
    }
    return this.initPromise;
  }

  public async countTokens(text: string): Promise<number> {
    await this.ensureEncoder();
    if (this.fallback) {
      return this.fallback.countTokens(text);
    }
    const key = cacheKeyFor(text);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const count = this.encoder!.encode(text).length;
    this.cache.set(key, count);
    return count;
  }

  public free(): void {
    if (this.encoder) {
      try {
        this.encoder.free();
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  public static supports(modelName: string): boolean {
    const mapped = TiktokenTokenizer.tryMap(modelName);
    return mapped !== null;
  }

  public static mapToTiktokenModel(modelName: string): TiktokenModel {
    const mapped = TiktokenTokenizer.tryMap(modelName);
    if (mapped === null) {
      // Default: GPT-4 tokenizer is the closest available for Claude/unknown models.
      return 'gpt-4';
    }
    return mapped;
  }

  private static tryMap(modelName: string): TiktokenModel | null {
    const lower = modelName.toLowerCase();
    if (
      lower.includes('claude') ||
      lower.includes('sonnet') ||
      lower.includes('opus') ||
      lower.includes('haiku') ||
      lower.includes('gpt-4')
    ) {
      return 'gpt-4';
    }
    if (lower.includes('gpt-3.5') || lower.includes('gpt3.5')) {
      return 'gpt-3.5-turbo';
    }
    if (SUPPORTED_TIKTOKEN_MODELS.includes(lower as TiktokenModel)) {
      return lower as TiktokenModel;
    }
    return null;
  }
}
