import type Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { LRUCache } from 'lru-cache';
import path from 'path';
import fs from 'fs';
import { IEmbeddingGenerator } from '../interfaces/IEmbeddingGenerator.js';
import { IVectorStore } from '../interfaces/IVectorStore.js';
// PATH RECONCILIATION (ported from vendor/token-optimizer-mcp, see
// src/optimizer/paths.ts's header): the original default here was
// `path.join(os.homedir(), '.token-optimizer-cache')`, gated by a
// `TOKEN_OPTIMIZER_CACHE_DIR` env var. Both are replaced by optiflow's own
// `~/.optiflow/optimizer/cache` convention -- one path scheme, not two.
import { getOptimizerCacheDir } from '../paths.js';

/**
 * `better-sqlite3` ships a native `.node` addon (see esbuild.config.mjs's
 * `nativeExternals` doc comment) that is not guaranteed to be present in a
 * real marketplace install -- Claude Code's automatic dependency install
 * always runs with `--ignore-scripts`, which breaks native addons that need
 * a build step, and the package itself requires Node >=22. A static
 * top-level `import` of it would fail Node's ESM module-graph resolution at
 * process start for every caller of this file (all 76 `smart_*` tools, via
 * `shared-instances.ts`'s singleton), even ones that never touch the cache.
 *
 * So the load is deferred to first real use (`loadBetterSqlite3Sync`) via a
 * `require()` obtained through `createRequire` -- a real CommonJS `require`
 * call resolved lazily is NOT statically analyzed by the ESM loader ahead of
 * time (unlike `import`), so a missing/incompatible package throws a normal,
 * catchable error at the point of the call instead of poisoning the whole
 * module graph. `require()` (rather than `await import()`) is used
 * deliberately here: `CacheEngine`'s public API (`get`/`set`/`delete`/
 * `clear`/`getStats`/`evictLRU`/`getAllEntries`) is synchronous and relied on
 * synchronously by all 76 tools plus the module-load-time singleton in
 * `shared-instances.ts` -- switching to an awaited dynamic import would force
 * an async refactor of every call site. If the module can't be loaded (or
 * throws for any other reason -- wrong ABI, unsupported Node, etc.), the
 * cache degrades to an in-memory `Map`-backed backend with the exact same
 * method surface: cache entries just don't survive a process restart, which
 * is an acceptable tradeoff for what is, after all, a cache.
 */
type SqliteDatabase = Database.Database;
// better-sqlite3's `.d.ts` merges a `declare namespace Database { ... }`
// (providing e.g. `Database.Database`, the instance type used above) with
// `declare const Database: BetterSqlite3.DatabaseConstructor; export =
// Database`. `BetterSqlite3.DatabaseConstructor` itself isn't exported, so
// the constructor's callable shape is reconstructed inline here rather than
// referencing it directly. This matters because `require()` (below) returns
// the raw CJS `module.exports` value directly -- i.e. the constructor
// itself -- NOT a `{ default: ctor }` wrapper the way an awaited `import()`
// would produce.
type BetterSqlite3Ctor = new (
  filename?: string,
  options?: Database.Options
) => Database.Database;

let betterSqlite3Ctor: BetterSqlite3Ctor | null | undefined; // undefined = not attempted yet

function loadBetterSqlite3Sync(): BetterSqlite3Ctor | null {
  if (betterSqlite3Ctor !== undefined) {
    return betterSqlite3Ctor;
  }
  try {
    const require = createRequire(import.meta.url);
    betterSqlite3Ctor = require('better-sqlite3') as BetterSqlite3Ctor;
  } catch {
    betterSqlite3Ctor = null;
  }
  return betterSqlite3Ctor;
}

let warnedCacheFallback = false;

function warnCacheFallbackOnce(err: unknown): void {
  if (warnedCacheFallback) return;
  warnedCacheFallback = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    `[optiflow] Persistent SQLite cache unavailable (${message}) -- falling back to an ` +
      `in-memory cache for this process. Cache entries will NOT persist across restarts. ` +
      `This is expected in a marketplace install without a manual "npm install better-sqlite3" ` +
      `(or on Node <22, which better-sqlite3 requires).`
  );
}

/**
 * Whether an error from opening/initializing SQLite indicates the database file
 * is corrupt or not a valid database (e.g. a partially-written file, or a
 * non-DB file left at the path). Such a file can be safely deleted and
 * recreated, so callers use this to decide whether to self-heal on retry.
 */
function isCorruptDatabaseError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  return (
    code === 'SQLITE_NOTADB' ||
    code === 'SQLITE_CORRUPT' ||
    /not a database|file is encrypted|is not a database|malformed/i.test(
      message
    )
  );
}

export interface CacheEntry {
  key: string;
  value: string;
  compressedSize: number;
  originalSize: number;
  hitCount: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  totalCompressedSize: number;
  totalOriginalSize: number;
  compressionRatio: number;
  semanticHits?: number; // Number of cache hits via semantic matching
  semanticHitRate?: number; // Semantic hits as percentage of total hits
}

export interface SemanticCachingConfig {
  similarityThreshold?: number; // Minimum cosine similarity for a match (0-1, default: 0.85)
  topK?: number; // Number of similar entries to search (default: 5)
  enabled?: boolean; // Enable semantic caching (default: true if generators provided)
}

interface EvictResult {
  deletedCount: number;
  survivingKeys: string[];
}

/**
 * Persistence backend abstraction so `CacheEngine`'s public API stays
 * identical regardless of whether real SQLite is available. See the module
 * header comment for why this exists.
 */
interface CacheBackend {
  getRow(key: string): { value: string; compressedSize: number } | undefined;
  upsert(
    key: string,
    value: string,
    originalSize: number,
    compressedSize: number
  ): void;
  /** Increments hit_count and refreshes last_accessed_at for `key`. */
  touch(key: string): void;
  deleteRow(key: string): boolean;
  deleteAll(): void;
  stats(): {
    totalEntries: number;
    totalHits: number;
    totalCompressed: number;
    totalOriginal: number;
  };
  evictLRU(maxSizeBytes: number): EvictResult;
  allEntries(): CacheEntry[];
  close(): void;
}

/** Real SQLite-backed persistence -- exact same schema/queries as before this change. */
class SqliteCacheBackend implements CacheBackend {
  constructor(private readonly db: SqliteDatabase) {}

  getRow(key: string): { value: string; compressedSize: number } | undefined {
    const stmt = this.db.prepare(`
      SELECT value, compressed_size FROM cache WHERE key = ?
    `);
    const row = stmt.get(key) as
      | { value: string; compressed_size: number }
      | undefined;
    if (!row) return undefined;
    return { value: row.value, compressedSize: row.compressed_size };
  }

  upsert(
    key: string,
    value: string,
    originalSize: number,
    compressedSize: number
  ): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cache
      (key, value, compressed_size, original_size, hit_count, created_at, last_accessed_at)
      VALUES (?, ?, ?, ?,
        COALESCE((SELECT hit_count FROM cache WHERE key = ?), 0),
        COALESCE((SELECT created_at FROM cache WHERE key = ?), ?),
        ?)
    `);
    stmt.run(key, value, compressedSize, originalSize, key, key, now, now);
  }

  touch(key: string): void {
    const stmt = this.db.prepare(`
      UPDATE cache
      SET hit_count = hit_count + 1, last_accessed_at = ?
      WHERE key = ?
    `);
    stmt.run(Date.now(), key);
  }

  deleteRow(key: string): boolean {
    const stmt = this.db.prepare('DELETE FROM cache WHERE key = ?');
    const result = stmt.run(key);
    return result.changes > 0;
  }

  deleteAll(): void {
    this.db.exec('DELETE FROM cache');
  }

  stats(): {
    totalEntries: number;
    totalHits: number;
    totalCompressed: number;
    totalOriginal: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_entries,
        SUM(hit_count) as total_hits,
        SUM(compressed_size) as total_compressed,
        SUM(original_size) as total_original
      FROM cache
    `);
    const row = stmt.get() as {
      total_entries: number;
      total_hits: number | null;
      total_compressed: number | null;
      total_original: number | null;
    };
    return {
      totalEntries: row.total_entries,
      totalHits: row.total_hits ?? 0,
      totalCompressed: row.total_compressed ?? 0,
      totalOriginal: row.total_original ?? 0,
    };
  }

  evictLRU(maxSizeBytes: number): EvictResult {
    const keysToKeep = this.db
      .prepare(
        `
      WITH ranked AS (
        SELECT
          key,
          compressed_size,
          SUM(compressed_size) OVER (ORDER BY last_accessed_at DESC, key ASC) as running_total
        FROM cache
      )
      SELECT key FROM ranked
      WHERE running_total <= ?
    `
      )
      .all(maxSizeBytes) as { key: string }[];

    if (keysToKeep.length === 0) {
      const result = this.db.prepare('DELETE FROM cache').run();
      return { deletedCount: result.changes, survivingKeys: [] };
    }

    const placeholders = keysToKeep.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      DELETE FROM cache WHERE key NOT IN (${placeholders})
    `);
    const result = stmt.run(...keysToKeep.map((k) => k.key));

    return {
      deletedCount: result.changes,
      survivingKeys: keysToKeep.map((k) => k.key),
    };
  }

  allEntries(): CacheEntry[] {
    const stmt = this.db.prepare(`
      SELECT
        key,
        value,
        compressed_size as compressedSize,
        original_size as originalSize,
        hit_count as hitCount,
        created_at as createdAt,
        last_accessed_at as lastAccessedAt
      FROM cache
      ORDER BY hit_count DESC, last_accessed_at DESC
    `);
    return stmt.all() as CacheEntry[];
  }

  close(): void {
    this.db.close();
  }
}

/**
 * In-memory fallback used when better-sqlite3 can't be loaded (or fails to
 * open/initialize for any reason). Matches `SqliteCacheBackend`'s exact
 * semantics -- including the hit_count/created_at-preserving upsert and the
 * running-total LRU eviction order -- but nothing here survives a process
 * restart.
 */
class MemoryCacheBackend implements CacheBackend {
  private readonly rows = new Map<string, CacheEntry>();

  getRow(key: string): { value: string; compressedSize: number } | undefined {
    const row = this.rows.get(key);
    if (!row) return undefined;
    return { value: row.value, compressedSize: row.compressedSize };
  }

  upsert(
    key: string,
    value: string,
    originalSize: number,
    compressedSize: number
  ): void {
    const now = Date.now();
    const existing = this.rows.get(key);
    this.rows.set(key, {
      key,
      value,
      compressedSize,
      originalSize,
      hitCount: existing?.hitCount ?? 0,
      createdAt: existing?.createdAt ?? now,
      lastAccessedAt: now,
    });
  }

  touch(key: string): void {
    const row = this.rows.get(key);
    if (row) {
      row.hitCount += 1;
      row.lastAccessedAt = Date.now();
    }
  }

  deleteRow(key: string): boolean {
    return this.rows.delete(key);
  }

  deleteAll(): void {
    this.rows.clear();
  }

  stats(): {
    totalEntries: number;
    totalHits: number;
    totalCompressed: number;
    totalOriginal: number;
  } {
    let totalHits = 0;
    let totalCompressed = 0;
    let totalOriginal = 0;
    for (const row of this.rows.values()) {
      totalHits += row.hitCount;
      totalCompressed += row.compressedSize;
      totalOriginal += row.originalSize;
    }
    return {
      totalEntries: this.rows.size,
      totalHits,
      totalCompressed,
      totalOriginal,
    };
  }

  evictLRU(maxSizeBytes: number): EvictResult {
    // Same ordering as the SQL window function: most-recently-accessed
    // first (ties broken by key ascending), keeping a running total.
    const ordered = [...this.rows.values()].sort((a, b) => {
      if (b.lastAccessedAt !== a.lastAccessedAt) {
        return b.lastAccessedAt - a.lastAccessedAt;
      }
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });

    const survivingKeys: string[] = [];
    let runningTotal = 0;
    for (const row of ordered) {
      runningTotal += row.compressedSize;
      if (runningTotal <= maxSizeBytes) {
        survivingKeys.push(row.key);
      } else {
        // Compressed sizes are non-negative, so once the running total
        // exceeds the budget every subsequent (older) row does too.
        break;
      }
    }

    const keep = new Set(survivingKeys);
    let deletedCount = 0;
    for (const key of Array.from(this.rows.keys())) {
      if (!keep.has(key)) {
        this.rows.delete(key);
        deletedCount += 1;
      }
    }

    return { deletedCount, survivingKeys };
  }

  allEntries(): CacheEntry[] {
    return [...this.rows.values()].sort((a, b) => {
      if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
      return b.lastAccessedAt - a.lastAccessedAt;
    });
  }

  close(): void {
    // Nothing to close.
  }
}

/**
 * Opens (or self-heals, then opens) the real SQLite backend at `finalDbPath`.
 * Throws on any unrecoverable failure -- including better-sqlite3 not being
 * loadable at all -- so the caller can fall back to `MemoryCacheBackend`.
 * This is the exact same retry/self-heal behavior as before this change,
 * just extracted so its failure can be caught at one boundary.
 */
function createSqliteBackend(finalDbPath: string): SqliteCacheBackend {
  const Database = loadBetterSqlite3Sync();
  if (!Database) {
    throw new Error(
      'better-sqlite3 native module could not be loaded (not installed, wrong ABI, ' +
        'or unsupported Node version -- better-sqlite3 requires Node >=22).'
    );
  }

  let lastError: Error | null = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let db: SqliteDatabase | undefined;
    try {
      if (attempt > 1 && isCorruptDatabaseError(lastError)) {
        for (const p of [
          finalDbPath,
          `${finalDbPath}-wal`,
          `${finalDbPath}-shm`,
        ]) {
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {
            // Best-effort: if a sidecar can't be removed, the open below may
            // still fail and we fall through to the next attempt / final error.
          }
        }
      }

      db = new Database(finalDbPath);
      db.pragma('journal_mode = WAL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          compressed_size INTEGER NOT NULL,
          original_size INTEGER NOT NULL,
          hit_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          last_accessed_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_last_accessed ON cache(last_accessed_at);
        CREATE INDEX IF NOT EXISTS idx_hit_count ON cache(hit_count);
      `);

      return new SqliteCacheBackend(db);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      try {
        if (db) db.close();
      } catch {
        // Ignore close errors
      }

      if (attempt < maxAttempts) {
        console.warn(
          `Cache database initialization attempt ${attempt}/${maxAttempts} failed:`,
          error
        );
        console.warn(`Retrying... (attempt ${attempt + 1}/${maxAttempts})`);
      }
    }
  }

  throw new Error(
    `Failed to initialize persistent cache database after ${maxAttempts} attempts. ` +
      `Last error: ${lastError?.message || 'Unknown error'}. ` +
      `Attempted path: ${finalDbPath}.`
  );
}

export class CacheEngine {
  private backend: CacheBackend;
  private memoryCache: LRUCache<
    string,
    { content: string; compressedSize: number }
  >;
  private dbPath!: string;
  private stats = {
    hits: 0,
    misses: 0,
    semanticHits: 0, // Track semantic cache hits separately
  };

  // Semantic caching components (optional)
  private embeddingGenerator?: IEmbeddingGenerator;
  private vectorStore?: IVectorStore;
  private semanticConfig: SemanticCachingConfig;

  constructor(
    dbPath?: string,
    maxMemoryItems: number = 1000,
    embeddingGenerator?: IEmbeddingGenerator,
    vectorStore?: IVectorStore,
    semanticConfig?: SemanticCachingConfig
  ) {
    // Use user-provided path, or default to optiflow's own
    // ~/.optiflow/optimizer/cache (see src/optimizer/paths.ts).
    const defaultCacheDir = getOptimizerCacheDir();

    // Resolve the cache directory and the database file path.
    //
    // `dbPath` is normally the database FILE path, but historically some callers
    // passed a cache DIRECTORY here (and upgraders may still have a directory at
    // that location on disk — e.g. ~/.hypercontext/cache/ containing cache.db).
    // If we're handed an existing directory, put the database inside it rather
    // than trying to open the directory as a SQLite file (which fails with
    // "unable to open database file").
    let cacheDir: string;
    let finalDbPath: string;
    if (dbPath) {
      let dbPathIsDirectory = false;
      try {
        dbPathIsDirectory =
          fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory();
      } catch {
        dbPathIsDirectory = false;
      }

      if (dbPathIsDirectory) {
        cacheDir = dbPath;
        finalDbPath = path.join(dbPath, 'cache.db');
      } else {
        cacheDir = path.dirname(dbPath);
        finalDbPath = dbPath;
      }
    } else {
      cacheDir = defaultCacheDir;
      finalDbPath = path.join(cacheDir, 'cache.db');
    }

    // Ensure cache directory exists.
    //
    // A parent that exists but is a FILE is the interesting case: existsSync is
    // true, so the mkdir is skipped, and SQLite then fails to open a path whose
    // parent is not a directory. That surfaced as three retries and
    // "CRITICAL: Failed to initialize persistent cache database", which says
    // nothing about the actual conflict. Naming it is the difference between a
    // one-line fix and an afternoon.
    if (fs.existsSync(cacheDir)) {
      if (!fs.statSync(cacheDir).isDirectory()) {
        throw new Error(
          `Cannot create the cache at ${finalDbPath}: ${cacheDir} is a file, not a directory. ` +
            `Something else is using that path -- remove or rename it, or pass a different cache location.`
        );
      }
    } else {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Try the real SQLite-backed persistence first; on ANY failure -- the
    // native module missing/incompatible, or the open/init retries above all
    // being exhausted -- degrade to an in-memory backend rather than crashing
    // the whole server (see this file's header comment).
    try {
      this.backend = createSqliteBackend(finalDbPath);
    } catch (err) {
      warnCacheFallbackOnce(err);
      this.backend = new MemoryCacheBackend();
    }
    this.dbPath = finalDbPath;

    // Initialize in-memory LRU cache for frequently accessed items
    this.memoryCache = new LRUCache<
      string,
      { content: string; compressedSize: number }
    >({
      max: maxMemoryItems,
      ttl: 1000 * 60 * 60, // 1 hour TTL
    });

    // Initialize semantic caching components (optional)
    this.embeddingGenerator = embeddingGenerator;
    this.vectorStore = vectorStore;
    this.semanticConfig = {
      similarityThreshold: semanticConfig?.similarityThreshold ?? 0.85,
      topK: semanticConfig?.topK ?? 5,
      enabled:
        semanticConfig?.enabled ??
        (embeddingGenerator !== undefined && vectorStore !== undefined),
    };
  }

  /**
   * Get a value from cache (synchronous, exact match only)
   * For backward compatibility, this method only performs exact key matching
   * Use getWithSemantic() for semantic similarity search
   */
  get(key: string): string | null {
    const result = this.getExact(key);
    if (result === null) {
      this.stats.misses++;
    }
    return result;
  }

  /**
   * Get a value from cache with semantic matching enabled
   * First tries exact key match, then semantic similarity if enabled
   */
  async getWithSemantic(key: string): Promise<string | null> {
    // Try exact key match first (fast path)
    const exactMatch = this.getExact(key);
    if (exactMatch !== null) {
      return exactMatch;
    }

    // If semantic caching is enabled, try similarity search
    if (
      this.semanticConfig.enabled &&
      this.embeddingGenerator &&
      this.vectorStore
    ) {
      try {
        const semanticMatch = await this.getSemanticMatch(key);
        if (semanticMatch !== null) {
          this.stats.semanticHits++;
          return semanticMatch;
        }
      } catch (error) {
        // Log error but don't fail - fall back to cache miss
        console.warn('Semantic cache lookup failed:', error);
      }
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Get a value from cache using exact key match (synchronous)
   */
  private getExact(key: string): string | null {
    // Check memory cache first
    const memValue = this.memoryCache.get(key);
    if (memValue !== undefined) {
      this.stats.hits++;
      this.backend.touch(key);
      return memValue.content;
    }

    // Check persistence backend
    const row = this.backend.getRow(key);

    if (row) {
      this.stats.hits++;
      // Update hit count and last accessed time
      this.backend.touch(key);
      // Add to memory cache for faster access
      this.memoryCache.set(key, {
        content: row.value,
        compressedSize: row.compressedSize,
      });
      return row.value;
    }

    return null;
  }

  /**
   * Get a value from cache using semantic similarity matching
   * Searches for similar queries and returns the closest match above threshold
   */
  private async getSemanticMatch(query: string): Promise<string | null> {
    if (!this.embeddingGenerator || !this.vectorStore) {
      return null;
    }

    // Generate embedding for the query
    const queryEmbedding =
      await this.embeddingGenerator.generateEmbedding(query);

    // Search for similar vectors in the store
    const results = await this.vectorStore.search(
      queryEmbedding,
      this.semanticConfig.topK || 5,
      this.semanticConfig.similarityThreshold || 0.85
    );

    if (results.length === 0) {
      return null;
    }

    // Get the most similar result
    const bestMatch = results[0];

    // Retrieve the cached value using the matched key
    const cachedValue = this.getExact(bestMatch.id);
    if (cachedValue !== null) {
      // Log semantic hit for debugging
      console.log(
        `Semantic cache hit: query="${query}" matched key="${bestMatch.id}" (similarity: ${bestMatch.similarity.toFixed(3)})`
      );
    }

    return cachedValue;
  }

  /**
   * Get a value from cache with metadata (including compression info)
   */
  getWithMetadata(
    key: string
  ): { content: string; compressedSize: number } | null {
    // Check memory cache first
    const memValue = this.memoryCache.get(key);
    if (memValue !== undefined) {
      this.stats.hits++;
      this.backend.touch(key);
      return memValue;
    }

    // Check persistence backend
    const row = this.backend.getRow(key);

    if (row) {
      this.stats.hits++;
      // Update hit count and last accessed time
      this.backend.touch(key);
      // Add to memory cache for faster access
      this.memoryCache.set(key, {
        content: row.value,
        compressedSize: row.compressedSize,
      });
      return {
        content: row.value,
        compressedSize: row.compressedSize,
      };
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Set a value in cache (synchronous, without semantic embedding)
   * For backward compatibility
   */
  set(
    key: string,
    value: string,
    originalSize: number,
    compressedSize: number
  ): void {
    this.backend.upsert(key, value, originalSize, compressedSize);

    // Add to memory cache
    this.memoryCache.set(key, { content: value, compressedSize });
  }

  /**
   * Set a value in cache with semantic embedding
   * Also generates and stores embedding if semantic caching is enabled
   */
  async setWithSemantic(
    key: string,
    value: string,
    originalSize: number,
    compressedSize: number
  ): Promise<void> {
    // First do the regular set
    this.set(key, value, originalSize, compressedSize);

    // Generate and store embedding if semantic caching is enabled
    if (
      this.semanticConfig.enabled &&
      this.embeddingGenerator &&
      this.vectorStore
    ) {
      try {
        const embedding = await this.embeddingGenerator.generateEmbedding(key);
        await this.vectorStore.add(key, embedding);
      } catch (error) {
        // Log error but don't fail the cache set operation
        console.warn(
          'Failed to generate/store embedding for cache key:',
          error
        );
      }
    }
  }

  /**
   * Delete a value from cache (synchronous)
   */
  delete(key: string): boolean {
    this.memoryCache.delete(key);
    return this.backend.deleteRow(key);
  }

  /**
   * Delete a value from cache with semantic embedding removal
   * Also removes the embedding if semantic caching is enabled
   */
  async deleteWithSemantic(key: string): Promise<boolean> {
    const result = this.delete(key);

    // Remove embedding if semantic caching is enabled
    if (this.semanticConfig.enabled && this.vectorStore) {
      try {
        await this.vectorStore.delete(key);
      } catch (error) {
        console.warn('Failed to delete embedding from vector store:', error);
      }
    }

    return result;
  }

  /**
   * Clear all cache (synchronous)
   */
  clear(): void {
    this.memoryCache.clear();
    this.backend.deleteAll();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.semanticHits = 0;
  }

  /**
   * Clear all cache including vector store
   * Also clears the vector store if semantic caching is enabled
   */
  async clearWithSemantic(): Promise<void> {
    this.clear();

    // Clear vector store if semantic caching is enabled
    if (this.semanticConfig.enabled && this.vectorStore) {
      try {
        await this.vectorStore.clear();
      } catch (error) {
        console.warn('Failed to clear vector store:', error);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const backendStats = this.backend.stats();

    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;
    const compressionRatio =
      backendStats.totalOriginal > 0
        ? backendStats.totalCompressed / backendStats.totalOriginal
        : 0;

    const totalHits = this.stats.hits + this.stats.semanticHits;
    const semanticHitRate =
      totalHits > 0 ? this.stats.semanticHits / totalHits : 0;

    return {
      totalEntries: backendStats.totalEntries,
      totalHits: backendStats.totalHits,
      totalMisses: this.stats.misses,
      hitRate,
      totalCompressedSize: backendStats.totalCompressed,
      totalOriginalSize: backendStats.totalOriginal,
      compressionRatio,
      semanticHits: this.stats.semanticHits,
      semanticHitRate,
    };
  }

  /**
   * Evict least recently used entries to stay under size limit
   */
  evictLRU(maxSizeBytes: number): number {
    const { deletedCount, survivingKeys } = this.backend.evictLRU(
      maxSizeBytes
    );

    if (survivingKeys.length === 0) {
      // Nothing fit in the limit -- everything was deleted.
      this.memoryCache.clear();
    } else {
      const keep = new Set(survivingKeys);
      for (const key of Array.from(this.memoryCache.keys())) {
        if (!keep.has(key)) {
          this.memoryCache.delete(key);
        }
      }
    }

    return deletedCount;
  }

  /**
   * Get all cache entries (for debugging/monitoring)
   */
  getAllEntries(): CacheEntry[] {
    return this.backend.allEntries();
  }

  /**
   * Get the database path currently in use
   */
  getDatabasePath(): string {
    return this.dbPath;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.backend.close();
  }
}
