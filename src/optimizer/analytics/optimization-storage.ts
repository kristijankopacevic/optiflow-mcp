// Ported from vendor/token-optimizer-mcp/src/analytics/optimization-storage.ts
// (MIT-licensed -- see THIRD_PARTY_LICENSES.md).
//
// PATH RECONCILIATION: the original default here was
// `join(homedir(), '.token-optimizer', 'optimization.db')`. Replaced by
// `src/optimizer/paths.ts`'s `getOptimizerOptimizationDbPath()`
// (`~/.optiflow/optimizer/optimization.db`) -- a separate on-disk SQLite
// database from `getOptimizerAnalyticsDbPath()` (this one is a
// content-addressed original-text -> optimized-text cache keyed by hash, a
// different schema/purpose vendor itself kept as a separate file), so it
// earns its own helper rather than reusing one.
//
// NOT YET WIRED: unlike the other 7 files under src/optimizer/analytics/,
// nothing in vendor's real `tools/analytics/*` (the 5 tools this checkpoint
// wires) or `analytics-manager.ts` actually calls into this module --
// verified by grep, its only real consumer is
// `vendor/token-optimizer-mcp/src/tools/optimization-storage-tool.ts`, a
// DIFFERENT tool outside this checkpoint's scope. Copied in per the merge
// plan's Part 1 file list (for provenance/completeness, matching the
// "copied-but-not-yet-wired" precedent already documented in server.ts's own
// header for dashboard-monitoring/UCR/wiki) and to satisfy
// `core/compression-engine.ts`'s only real dependent, but not constructed or
// exposed anywhere in `createOptimizerRuntime()`.
//
// LAZY/OPTIONAL better-sqlite3: same rationale as `core/cache-engine.ts`'s
// header comment (native `.node` addon, not guaranteed present in a
// marketplace install). This class's public API (`initializeDatabase`/
// `save`/`get`/`close`) is fully synchronous and not reachable from
// `createOptimizerRuntime()` today, but the same `require()`-via-
// `createRequire` deferred-load pattern is applied for consistency with the
// other four call sites and in case something constructs this class
// directly (e.g. a future wiring, or a test) without going through the
// server's own graceful-degradation path. On failure it falls back to an
// in-memory `Map` keyed by `originalTextHash` -- this class is
// content-addressed by hash already, the same shape `CacheEngine`'s own
// fallback uses, not an append-only log like `analytics-storage.ts`.

import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { CompressionEngine } from '../core/compression-engine.js';
import { getOptimizerOptimizationDbPath } from '../paths.js';

type SqliteDatabase = Database.Database;
// See core/cache-engine.ts's equivalent comment: better-sqlite3's
// `.d.ts` doesn't export its `DatabaseConstructor` type directly, and
// `require()` (used here, not an awaited `import()`) returns the raw
// CommonJS `module.exports` value -- the constructor itself.
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

let warnedOptimizationFallback = false;

function warnOptimizationFallbackOnce(err: unknown): void {
  if (warnedOptimizationFallback) return;
  warnedOptimizationFallback = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    `[optiflow] Persistent SQLite optimization storage unavailable (${message}) -- falling back ` +
      `to an in-memory cache for this process. This is expected in a marketplace install without ` +
      `a manual "npm install better-sqlite3".`
  );
}

export interface OptimizationResult {
  originalTextHash: string;
  optimizedText: string;
  originalTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
}

export function getDefaultOptimizationDbPath(): string {
  return getOptimizerOptimizationDbPath();
}

interface MemoryRecord {
  compressed: Buffer;
  algorithm: string;
  originalTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
}

export class SqliteOptimizationStorage {
  private db: SqliteDatabase | null = null;
  private memory: Map<string, MemoryRecord> | null = null;
  private readonly dbPath: string;
  private readonly compressionEngine: CompressionEngine;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? getDefaultOptimizationDbPath();
    this.compressionEngine = new CompressionEngine();
  }

  public initializeDatabase(): void {
    try {
      const Ctor = loadBetterSqlite3Sync();
      if (!Ctor) {
        throw new Error('better-sqlite3 native module could not be loaded');
      }
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const db = new Ctor(this.dbPath);
      db.pragma('journal_mode = WAL');
      db.exec(`
            CREATE TABLE IF NOT EXISTS optimization_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_text_hash TEXT NOT NULL UNIQUE,
                optimized_text_compressed BLOB NOT NULL,
                compression_algorithm TEXT NOT NULL,
                original_tokens INTEGER NOT NULL,
                optimized_tokens INTEGER NOT NULL,
                tokens_saved INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_optimization_hash
                ON optimization_results(original_text_hash);
        `);
      this.db = db;
      this.memory = null;
    } catch (err) {
      warnOptimizationFallbackOnce(err);
      this.db = null;
      this.memory = new Map();
    }
  }

  private requireBackendReady(): void {
    if (!this.db && !this.memory) {
      throw new Error(
        'Optimization storage database is not initialized. Call initializeDatabase() first.'
      );
    }
  }

  public save(entry: OptimizationResult): void {
    this.requireBackendReady();
    const compressed = this.compressionEngine.compress(entry.optimizedText);

    if (this.memory) {
      this.memory.set(entry.originalTextHash, {
        compressed: compressed.compressed,
        algorithm: SqliteOptimizationStorage.COMPRESSION_ALGORITHM,
        originalTokens: entry.originalTokens,
        optimizedTokens: entry.optimizedTokens,
        tokensSaved: entry.tokensSaved,
      });
      return;
    }

    this.db!.prepare(
      `INSERT OR REPLACE INTO optimization_results
             (original_text_hash, optimized_text_compressed, compression_algorithm,
              original_tokens, optimized_tokens, tokens_saved)
             VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      entry.originalTextHash,
      compressed.compressed,
      SqliteOptimizationStorage.COMPRESSION_ALGORITHM,
      entry.originalTokens,
      entry.optimizedTokens,
      entry.tokensSaved
    );
  }

  public get(originalTextHash: string): OptimizationResult | null {
    this.requireBackendReady();

    if (this.memory) {
      const row = this.memory.get(originalTextHash);
      if (!row) return null;
      return {
        originalTextHash,
        optimizedText: this.decodePayload(row.compressed, row.algorithm),
        originalTokens: row.originalTokens,
        optimizedTokens: row.optimizedTokens,
        tokensSaved: row.tokensSaved,
      };
    }

    const row = this.db!
      .prepare(
        `SELECT optimized_text_compressed, compression_algorithm,
                    original_tokens, optimized_tokens, tokens_saved
             FROM optimization_results WHERE original_text_hash = ?`
      )
      .get(originalTextHash) as
      | {
          optimized_text_compressed: Buffer;
          compression_algorithm: string;
          original_tokens: number;
          optimized_tokens: number;
          tokens_saved: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      originalTextHash,
      optimizedText: this.decodePayload(
        row.optimized_text_compressed,
        row.compression_algorithm
      ),
      originalTokens: row.original_tokens,
      optimizedTokens: row.optimized_tokens,
      tokensSaved: row.tokens_saved,
    };
  }

  /**
   * Decode a stored payload using the persisted algorithm label. Keeps
   * the door open for additional algorithms (gzip, zstd) without
   * touching the read path, and surfaces an explicit error for
   * unknown labels instead of silently corrupting data.
   */
  private decodePayload(buffer: Buffer, algorithm: string | null): string {
    if (algorithm === 'brotli') {
      return this.compressionEngine.decompress(buffer);
    }
    if (algorithm === 'none' || algorithm === '') {
      return buffer.toString('utf8');
    }
    if (algorithm === null || algorithm === undefined) {
      // Legacy rows without a recorded algorithm: pre-tracking code
      // always wrote brotli, but we still accept raw UTF-8 as a last
      // resort so a one-off plaintext row doesn't poison reads.
      try {
        return this.compressionEngine.decompress(buffer);
      } catch {
        return buffer.toString('utf8');
      }
    }
    throw new Error(
      `Unknown compression_algorithm in optimization_results: ${algorithm}`
    );
  }

  /** Algorithm label paired with the current CompressionEngine. */
  public static readonly COMPRESSION_ALGORITHM = 'brotli';

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.memory = null;
  }
}
