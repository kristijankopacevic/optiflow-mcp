// Ported from vendor/token-optimizer-mcp/src/analytics/analytics-storage.ts
// (MIT-licensed -- see THIRD_PARTY_LICENSES.md).
//
// PATH RECONCILIATION: the original default here was
// `path.join(os.homedir(), '.token-optimizer-mcp', 'analytics.db')`, with a
// `TOKEN_OPTIMIZER_ANALYTICS_DB` env var override. Both are replaced by
// `src/optimizer/paths.ts`'s `getOptimizerAnalyticsDbPath()`
// (`~/.optiflow/optimizer/analytics.db`) -- one path convention, not two,
// matching every other ported module's own reconciliation (see
// `core/cache-engine.ts`'s equivalent header). This is that helper's first
// real consumer -- it was defined by an earlier checkpoint but never
// wired to anything until now.
//
// UN-UNREF()'D TIMER FIX (same bug class checkpoint 7 found/fixed in
// advanced-caching's cache-invalidation.ts/cache-replication.ts/
// smart-cache.ts): `scheduleBatchFlush()` below starts a plain
// `setTimeout(..., BATCH_DELAY_MS)` with no `.unref()`. It's not
// constructor-started (only armed on-demand by `save()`, and it
// self-clears via `flushBatch()`), so the severity is the same
// lower tier checkpoint 7 documented for `cache-invalidation.ts`'s
// `lazyProcessTimer`/`smart-cache.ts`'s `writeBackTimer` -- but any single
// `track()`/`save()` call (which `record-tool-analytics.ts`'s dispatch-level
// recording, wired in this checkpoint, calls on EVERY tool call) arms it, so
// a short-lived process (tests, the stdio smoke test) that calls any tool
// once and then tries to exit within 5s would otherwise hang on this timer
// alone. Fixed live: `.unref()` called immediately after creation, matching
// the precedent already set for the other timers in this bug class.
//
// LAZY/OPTIONAL better-sqlite3 (this checkpoint): `better-sqlite3` ships a
// native `.node` addon that is not guaranteed to be present in a real
// marketplace install (see `core/cache-engine.ts`'s header comment for the
// full rationale -- same package, same failure mode). Every public method
// here is already async (`AnalyticsManager`, this class's only real caller,
// always awaits them), so unlike `CacheEngine`/`TokenCounter` this class can
// use a real awaited dynamic `import()` deferred to first use, with an
// append-only JSONL log (matching `src/core/ledger.ts`'s existing
// conventions: writes never throw, unparseable lines are skipped on read)
// as the fallback -- a closer fit than an in-memory Map given this class's
// actual shape (append events, then query/filter them), not a keyed cache.

import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import type { AnalyticsEntry, AnalyticsStorage } from './analytics-types.js';
import { getOptimizerAnalyticsDbPath } from '../paths.js';
import fs from 'node:fs';
import path from 'node:path';

// See this file's header + `core/cache-engine.ts`'s equivalent comment:
// `better-sqlite3`'s `.d.ts` uses `export = Database` merged with a
// `declare namespace Database`, so the constructor's callable shape is
// reconstructed inline (`BetterSqlite3.DatabaseConstructor` itself isn't
// exported). An awaited `import()` (unlike `require()`) resolves the
// constructor at `.default`, matching Node's CJS/ESM interop and the
// existing precedent in `smart-schema.ts`'s
// `const { default: Database } = await import('better-sqlite3');`.
type BetterSqlite3Ctor = new (
  filename?: string,
  options?: Database.Options
) => Database.Database;

let betterSqlite3LoadPromise: Promise<BetterSqlite3Ctor | null> | null = null;

async function loadBetterSqlite3(): Promise<BetterSqlite3Ctor | null> {
  if (!betterSqlite3LoadPromise) {
    betterSqlite3LoadPromise = import('better-sqlite3')
      .then((mod) => {
        const ctor = (mod as { default?: BetterSqlite3Ctor }).default;
        if (!ctor) {
          throw new Error(
            'better-sqlite3 module resolved but had no default export'
          );
        }
        return ctor;
      })
      .catch(() => null);
  }
  return betterSqlite3LoadPromise;
}

let warnedAnalyticsFallback = false;

function warnAnalyticsFallbackOnce(err: unknown): void {
  if (warnedAnalyticsFallback) return;
  warnedAnalyticsFallback = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    `[optiflow] Persistent SQLite analytics storage unavailable (${message}) -- falling back to ` +
      `an append-only JSONL log for this process (see analytics-storage.ts). This is expected in ` +
      `a marketplace install without a manual "npm install better-sqlite3".`
  );
}

/** Same directory/stem as the intended SQLite path, `.fallback.jsonl` suffixed. */
function fallbackPathFor(dbPath: string): string {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath, path.extname(dbPath)) || 'analytics';
  return path.join(dir, `${base}.fallback.jsonl`);
}

/**
 * Append-only JSONL fallback used when better-sqlite3 can't be loaded.
 * Mirrors `src/core/ledger.ts`'s conventions (writes never throw, corrupt/
 * unparseable lines are skipped on read) rather than the SQLite schema's
 * exact on-disk shape. Approximates the same unique-index dedup the SQLite
 * schema enforces on `measurement_id LIKE 'mcp:%'` by checking for an
 * existing entry with the same id before appending.
 */
class JsonlAnalyticsFallback implements AnalyticsStorage {
  constructor(private readonly filePath: string) {
    const dir = path.dirname(filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {
      // Best-effort -- a failed mkdir here surfaces later as failed
      // appends, which are themselves swallowed (see appendOne below).
    }
  }

  private readAll(): AnalyticsEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      return [];
    }
    const out: AnalyticsEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof parsed.timestamp === 'string'
        ) {
          out.push(parsed as AnalyticsEntry);
        }
      } catch {
        // Skip unparseable lines rather than failing the whole read.
      }
    }
    return out;
  }

  private appendOne(entry: AnalyticsEntry): void {
    if (entry.measurementId?.startsWith('mcp:')) {
      const existing = this.readAll();
      if (existing.some((e) => e.measurementId === entry.measurementId)) {
        return; // Matches the SQLite schema's `ON CONFLICT DO NOTHING`.
      }
    }
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // Writes must never throw -- matches src/core/ledger.ts's convention.
    }
  }

  private static sortDesc(entries: AnalyticsEntry[]): AnalyticsEntry[] {
    return [...entries].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0
    );
  }

  async save(entry: AnalyticsEntry): Promise<void> {
    this.appendOne(entry);
  }

  async saveBatch(entries: AnalyticsEntry[]): Promise<void> {
    for (const entry of entries) {
      this.appendOne(entry);
    }
  }

  async query(filters?: Partial<AnalyticsEntry>): Promise<AnalyticsEntry[]> {
    let entries = this.readAll();
    if (filters) {
      entries = entries.filter((e) => {
        if (filters.hookPhase && e.hookPhase !== filters.hookPhase)
          return false;
        if (filters.toolName && e.toolName !== filters.toolName)
          return false;
        if (filters.mcpServer && e.mcpServer !== filters.mcpServer)
          return false;
        if (filters.sessionId && e.sessionId !== filters.sessionId)
          return false;
        return true;
      });
    }
    return JsonlAnalyticsFallback.sortDesc(entries);
  }

  async queryByDateRange(
    startDate: string,
    endDate: string
  ): Promise<AnalyticsEntry[]> {
    const entries = this.readAll().filter(
      (e) => e.timestamp >= startDate && e.timestamp <= endDate
    );
    return JsonlAnalyticsFallback.sortDesc(entries);
  }

  async clear(): Promise<void> {
    try {
      fs.writeFileSync(this.filePath, '', 'utf8');
    } catch {
      // Best-effort, matching the write convention above.
    }
  }

  async count(): Promise<number> {
    return this.readAll().length;
  }

  close(): void {
    // Every save() already wrote synchronously -- nothing to flush.
  }
}

/**
 * SQLite-backed analytics storage
 */
export class SqliteAnalyticsStorage implements AnalyticsStorage {
  private db: Database.Database | null = null;
  private fallback: JsonlAnalyticsFallback | null = null;
  private backendReadyPromise: Promise<void> | null = null;
  private readonly finalPath: string;
  private batchQueue: AnalyticsEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_DELAY_MS = 5000; // 5 seconds

  constructor(dbPath?: string) {
    // Default to optiflow's own ~/.optiflow/optimizer/analytics.db (see
    // src/optimizer/paths.ts) -- was ~/.token-optimizer-mcp/analytics.db
    // (optionally overridden by TOKEN_OPTIMIZER_ANALYTICS_DB) before this
    // reconciliation.
    //
    // Deliberately does NOT touch the filesystem or load better-sqlite3
    // here -- that's deferred to `ensureBackend()`, called at the top of
    // every public method below, so a missing/incompatible better-sqlite3
    // never throws out of a plain `new SqliteAnalyticsStorage()`.
    this.finalPath = dbPath || getOptimizerAnalyticsDbPath();
  }

  /**
   * Lazily resolves which backend to use, memoized so concurrent calls
   * don't race to initialize twice. On any failure -- better-sqlite3
   * missing, or the DB open/schema-init throwing for any reason -- degrades
   * to the JSONL fallback instead of throwing.
   */
  private ensureBackend(): Promise<void> {
    if (!this.backendReadyPromise) {
      this.backendReadyPromise = (async () => {
        try {
          const Ctor = await loadBetterSqlite3();
          if (!Ctor) {
            throw new Error('better-sqlite3 native module could not be loaded');
          }
          const dir = path.dirname(this.finalPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          this.db = new Ctor(this.finalPath);
          this.initializeDatabase();
        } catch (err) {
          warnAnalyticsFallbackOnce(err);
          this.db = null;
          this.fallback = new JsonlAnalyticsFallback(
            fallbackPathFor(this.finalPath)
          );
        }
      })();
    }
    return this.backendReadyPromise;
  }

  /**
   * Initialize database schema
   */
  private initializeDatabase(): void {
    const db = this.db!;
    db.exec(`
      CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hook_phase TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        mcp_server TEXT NOT NULL,
        original_tokens INTEGER NOT NULL,
        optimized_tokens INTEGER NOT NULL,
        tokens_saved INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        session_id TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_hook_phase ON analytics(hook_phase);
      CREATE INDEX IF NOT EXISTS idx_tool_name ON analytics(tool_name);
      CREATE INDEX IF NOT EXISTS idx_mcp_server ON analytics(mcp_server);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON analytics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_session_id ON analytics(session_id);
    `);

    const columns = new Set(
      (
        db.prepare('PRAGMA table_info(analytics)').all() as Array<{
          name: string;
        }>
      ).map((column) => column.name)
    );
    for (const [name, definition] of [
      ['client', 'TEXT'],
      ['client_version', 'TEXT'],
      ['model', 'TEXT'],
      ['model_version', 'TEXT'],
      ['measurement_id', 'TEXT'],
      // A pre-existing row has no provenance proving that its two token fields
      // are comparable. Defaulting this column to true silently certified every
      // historical estimate during migration. New writers opt in explicitly.
      ['savings_measured', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
      if (!columns.has(name))
        db.exec(`ALTER TABLE analytics ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_client ON analytics(client);
      CREATE INDEX IF NOT EXISTS idx_model ON analytics(model);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_measurement_id
        ON analytics(measurement_id)
        WHERE measurement_id LIKE 'mcp:%';
    `);
  }

  /**
   * Save a single analytics entry (batched for performance)
   */
  async save(entry: AnalyticsEntry): Promise<void> {
    await this.ensureBackend();
    if (this.fallback) {
      return this.fallback.save(entry);
    }

    this.batchQueue.push(entry);

    // Flush immediately if batch size reached
    if (this.batchQueue.length >= this.BATCH_SIZE) {
      await this.flushBatch();
    } else {
      // Otherwise, schedule a delayed flush
      this.scheduleBatchFlush();
    }
  }

  /**
   * Save multiple analytics entries in a single transaction
   */
  async saveBatch(entries: AnalyticsEntry[]): Promise<void> {
    await this.ensureBackend();
    if (this.fallback) {
      return this.fallback.saveBatch(entries);
    }
    if (entries.length === 0) return;

    const db = this.db!;
    const stmt = db.prepare(`
      INSERT INTO analytics (
        hook_phase, tool_name, mcp_server,
        original_tokens, optimized_tokens, tokens_saved,
        timestamp, session_id, metadata,
        client, client_version, model, model_version, savings_measured,
        measurement_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `);

    const insertMany = db.transaction((entries: AnalyticsEntry[]) => {
      for (const entry of entries) {
        stmt.run(
          entry.hookPhase,
          entry.toolName,
          entry.mcpServer,
          entry.originalTokens,
          entry.optimizedTokens,
          entry.tokensSaved,
          entry.timestamp,
          entry.sessionId || null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          entry.client || null,
          entry.clientVersion || null,
          entry.model || null,
          entry.modelVersion || null,
          entry.savingsMeasured === true ? 1 : 0,
          entry.measurementId || null
        );
      }
    });

    insertMany(entries);
  }

  /**
   * Schedule a delayed batch flush
   */
  private scheduleBatchFlush(): void {
    if (this.batchTimer) {
      return; // Timer already scheduled
    }

    this.batchTimer = setTimeout(() => {
      void this.flushBatch().catch((err) => {
        console.error('Failed to flush analytics batch:', err);
      });
    }, this.BATCH_DELAY_MS);
    // Real fix (not in vendor): a short-lived process (tests, the stdio
    // smoke test) that calls any tool once must be able to exit within the
    // 5s delay window rather than hang on this timer alone -- see this
    // file's header.
    this.batchTimer.unref();
  }

  /**
   * Flush the current batch to database
   */
  private async flushBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.batchQueue.length === 0) {
      return;
    }

    const entries = [...this.batchQueue];
    this.batchQueue = [];

    await this.saveBatch(entries);
  }

  /**
   * Query analytics entries with optional filters
   */
  async query(filters?: Partial<AnalyticsEntry>): Promise<AnalyticsEntry[]> {
    await this.ensureBackend();
    if (this.fallback) {
      return this.fallback.query(filters);
    }

    // Ensure any pending writes are flushed
    await this.flushBatch();

    let sql = 'SELECT * FROM analytics WHERE 1=1';
    const params: any[] = [];

    if (filters) {
      if (filters.hookPhase) {
        sql += ' AND hook_phase = ?';
        params.push(filters.hookPhase);
      }
      if (filters.toolName) {
        sql += ' AND tool_name = ?';
        params.push(filters.toolName);
      }
      if (filters.mcpServer) {
        sql += ' AND mcp_server = ?';
        params.push(filters.mcpServer);
      }
      if (filters.sessionId) {
        sql += ' AND session_id = ?';
        params.push(filters.sessionId);
      }
    }

    sql += ' ORDER BY timestamp DESC';

    const rows = this.db!.prepare(sql).all(...params) as any[];
    return this.rowsToEntries(rows);
  }

  /**
   * Get all entries within a date range
   */
  async queryByDateRange(
    startDate: string,
    endDate: string
  ): Promise<AnalyticsEntry[]> {
    await this.ensureBackend();
    if (this.fallback) {
      return this.fallback.queryByDateRange(startDate, endDate);
    }

    // Ensure any pending writes are flushed
    await this.flushBatch();

    const sql = `
      SELECT * FROM analytics
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
    `;

    const rows = this.db!.prepare(sql).all(startDate, endDate) as any[];
    return this.rowsToEntries(rows);
  }

  /**
   * Clear all analytics data
   */
  async clear(): Promise<void> {
    await this.ensureBackend();
    if (this.fallback) {
      return this.fallback.clear();
    }

    // Flush any pending writes first
    await this.flushBatch();

    this.db!.prepare('DELETE FROM analytics').run();
  }

  /**
   * Get total count of stored entries
   */
  async count(): Promise<number> {
    await this.ensureBackend();
    if (this.fallback) {
      return this.fallback.count();
    }

    // Ensure any pending writes are flushed
    await this.flushBatch();

    const result = this.db!.prepare('SELECT COUNT(*) as count FROM analytics')
      .get() as { count: number };
    return result.count;
  }

  /**
   * Convert database rows to AnalyticsEntry objects
   */
  private rowsToEntries(rows: any[]): AnalyticsEntry[] {
    return rows.map((row) => ({
      hookPhase: row.hook_phase,
      toolName: row.tool_name,
      mcpServer: row.mcp_server,
      originalTokens: row.original_tokens,
      optimizedTokens: row.optimized_tokens,
      tokensSaved: row.tokens_saved,
      timestamp: row.timestamp,
      sessionId: row.session_id || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      client: row.client || undefined,
      clientVersion: row.client_version || undefined,
      model: row.model || undefined,
      modelVersion: row.model_version || undefined,
      savingsMeasured: row.savings_measured !== 0,
      measurementId: row.measurement_id || undefined,
    }));
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    await this.ensureBackend();
    if (this.fallback) {
      return this.fallback.close();
    }

    // Flush any pending writes
    if (this.batchQueue.length > 0) {
      await this.saveBatch(this.batchQueue);
      this.batchQueue = [];
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    this.db!.close();
  }
}
