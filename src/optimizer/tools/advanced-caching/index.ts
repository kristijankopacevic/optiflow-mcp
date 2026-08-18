/**
 * Advanced Caching Tools - Multi-Tier Caching, Predictive Warming, ML
 * Prediction, Analytics, Benchmarking, Compression, Invalidation,
 * Optimization, Partitioning, and Replication
 *
 * *** ALL 10 REAL TOOLS ARE WIRED/EXPORTED HERE *** (smart_cache,
 * predictive_cache, cache_warmup, cache_analytics, cache_benchmark,
 * cache_compression, cache_invalidation, cache_optimizer, cache_partition,
 * cache_replication) -- the largest category merged so far by file count
 * (10 tool files, ~17,100 lines) and the first one with zero deferrals.
 *
 * DUAL-SIGNAL VERIFICATION (per the merge plan's own checkpoint-4 lesson):
 * vendor's own category `index.ts` UNDER-REPORTS this category just like it
 * did for build-systems -- it exports only `CacheCompressionTool` +
 * `CacheBenchmark` (plus their runners/definitions), with a comment noting
 * "Cache Analytics Tool -- Implementation pending" immediately after, and
 * silently omits invalidation/optimizer/partition/replication/warmup/
 * predictive/smart-cache entirely (never even mentioned as pending). Vendor's
 * REAL `src/server/index.ts` tells a completely different story, confirmed
 * by reading it directly: all 10 files are imported and every one has a
 * real `case 'xxx':` dispatch (`predictive_cache`/`cache_warmup` imported
 * near the top alongside the "previously unregistered tools" fixes;
 * `cache_analytics`/`cache_benchmark`/`cache_compression`/
 * `cache_invalidation`/`cache_optimizer`/`cache_partition`/
 * `cache_replication`/`smart_cache` imported a little further down,
 * dispatched at lines 2081-2196 of that file). The real server dispatch is
 * authoritative, per the plan -- all 10 copied and wired, nothing deferred
 * as a stub.
 *
 * NO PROJECTROOT-STALENESS BUG CLASS HERE: verified by grep across all 10
 * files -- none of them accept, advertise, or reference a `projectRoot`
 * option at all (this category operates purely on cache keys/values via the
 * shared `CacheEngine`, not on a project's file tree), so the bug class
 * checkpoints 4/5/6 found and fixed in other categories simply doesn't
 * apply to any tool in this one.
 *
 * NO ARCHITECTURAL-MISMATCH DEFERRALS: despite `cache-replication.ts`'s and
 * `cache-partition.ts`'s doc comments describing "distributed cache
 * coordination" / "sharding" in real distributed-systems vocabulary
 * (primary-replica, vector clocks, consistent hashing, quorum writes,
 * regional replication), verified by reading both files' imports directly
 * that NEITHER (nor any of the other 8) imports `net`, `http`, `tls`,
 * `dgram`, a Redis client, or any HTTP client (`fetch`/`axios`/
 * `node-fetch`) -- every "node"/"replica"/"partition" in this category is a
 * pure in-process simulation over the shared `CacheEngine` plus in-memory
 * `Map`s (health checks, sync, snapshots, and heartbeats all run as
 * `setInterval` timers driving the SAME process's own state, not real RPCs
 * to other machines). That matches optiflow's actual single-process local
 * plugin architecture rather than fighting it, so nothing here needed the
 * "defer -- would need a live network service / distributed backend"
 * treatment the plan warned this category might require.
 *
 * A GENUINE NEW PERSISTENCE NEED (the one thing this category DID add to
 * paths.ts, unlike every earlier checkpoint which only reused existing
 * helpers): `cache-benchmark.ts`'s `report` operation had a hardcoded
 * `join(homedir(), '.hypercontext', 'reports', ...)` default output path
 * for its generated benchmark report file -- reconciled to a new
 * `getOptimizerReportsDir()` helper in `src/optimizer/paths.ts`
 * (`~/.optiflow/optimizer/reports`). This is a real, separate on-disk
 * artifact (a saved report file), distinct from the already-reconciled
 * cache/config/sessions/wiki/projects/backups paths, so it earned its own
 * helper rather than reusing one. A second, related real fix: vendor's own
 * default path was never `mkdirSync`-created before the `writeFileSync`
 * call that used it (a real pre-existing gap that only surfaces on a clean
 * machine with no prior `.hypercontext` directory) -- fixed live here with
 * an explicit `mkdirSync(..., { recursive: true })` before the write, not
 * silently carried over. No other file in this category has its own
 * hardcoded default path or a separate on-disk persistence layer beyond the
 * shared `CacheEngine` -- `predictive-cache.ts`'s model export/import
 * (`export-model`/`import-model` operations) reads/writes ONLY a
 * caller-supplied `modelPath` (required, no default), same category as
 * `smart_write`'s arbitrary destination paths elsewhere in this server, not
 * a new persistence convention to reconcile.
 *
 * VENDOR DISPATCH SHAPE (verified case-by-case against
 * `vendor/token-optimizer-mcp/src/server/index.ts`, not assumed): 8 of the
 * 10 are whole-args-object `.run(options)` calls through a
 * `getXxxTool(cache, tokenCounter, metrics[, nodeId])` shared-instance
 * factory -- `predictive_cache`, `cache_warmup`, `cache_analytics`,
 * `cache_invalidation`, `cache_optimizer`, `cache_partition`,
 * `cache_replication`, `smart_cache` -- matching this merge's own
 * established shared-instance convention exactly, not just by coincidence.
 * `getCacheInvalidationTool`/`getCacheReplicationTool` both accept an
 * optional 4th `nodeId?: string` param; vendor's own dispatch construction
 * calls them with only the first 3 args (verified directly), so this merge
 * does the same -- no `nodeId` passed, matching vendor's real behavior.
 *
 * The remaining 2 (`cache_benchmark`, `cache_compression`) are the two
 * REAL DEFECTS this checkpoint found and did NOT replicate, matching the
 * precedent checkpoint 6 already set for `runSmartSymbols`:
 *   - `runCacheCompression` (the free function vendor's dispatch actually
 *     calls) is a MODULE-LEVEL SINGLETON that builds its own throwaway
 *     `new CacheEngine()`/`new TokenCounter()`/`new MetricsCollector()` on
 *     first call and memoizes that instance forever -- it silently ignores
 *     the shared instances the server already constructed and would open a
 *     SECOND, uncoordinated `CacheEngine` (a second SQLite handle) the
 *     moment `cache_compression` was ever called. Not replicated: this
 *     merge instead constructs one shared `new CacheCompressionTool(cache,
 *     tokenCounter, metrics)` directly in `createOptimizerRuntime()` (same
 *     constructor signature vendor's own class already has) and dispatches
 *     via ITS `.run(options)`, keeping every tool on the one real shared
 *     `CacheEngine`/`TokenCounter`/`MetricsCollector` triple.
 *   - `runCacheBenchmark` DOES thread the real shared instances through
 *     correctly (`(options, cache, tokenCounter, metrics)`), but its return
 *     type is `Promise<string>` -- it does `JSON.stringify(result, null,
 *     2)` internally on `CacheBenchmark.run()`'s real result object, and
 *     vendor's dispatch then does `JSON.stringify(result, null, 2)` AGAIN
 *     on that already-stringified string -- the exact same double-encoding
 *     defect class checkpoint 6 documented for `runSmartSymbols`/
 *     `runSmartTypescript`. Not replicated: this merge constructs one
 *     shared `new CacheBenchmark(cache, tokenCounter, metrics)` directly and
 *     dispatches via ITS OWN `.run(options)` (returns the real
 *     `CacheBenchmarkResult` object, no double-stringify). Both free
 *     functions (`runCacheCompression`, `runCacheBenchmark`) are still
 *     exported below for completeness/parity with vendor's own module
 *     surface, but neither is what `server.ts`'s dispatch table actually
 *     calls.
 *
 * SIX TYPE-NAME COLLISIONS RESOLVED (this category's 11 files gave it by
 * far the largest surface area for this class of problem so far -- more
 * than checkpoint 3's single `CircularDependency` collision). Each resolved
 * below with an aliased re-export, choosing the more semantically "central"
 * file (the tool the name most belongs to, or the one with a matching
 * sibling-type trio) as the unaliased canonical export, matching checkpoint
 * 3's own precedent of aliasing the non-canonical side rather than both:
 *   - `EvictionStrategy`: canonical in `smart-cache.ts` (the tool whose
 *     entire multi-tier-eviction design this type describes);
 *     `cache-optimizer.ts`'s own (differently-valued) type aliased to
 *     `OptimizerEvictionStrategy`.
 *   - `CacheTier`: same reasoning/pairing as above; `cache-optimizer.ts`'s
 *     aliased to `OptimizerCacheTier`.
 *   - `PerformanceMetrics`: canonical in `cache-optimizer.ts`;
 *     `cache-analytics.ts`'s (a differently-shaped dashboard metrics type)
 *     aliased to `AnalyticsPerformanceMetrics`.
 *   - `SimulationResult`: canonical in `cache-optimizer.ts`;
 *     `cache-warmup.ts`'s aliased to `WarmupSimulationResult`.
 *   - `Prediction`: canonical in `predictive-cache.ts` (the tool this type
 *     is the literal namesake of); `cache-analytics.ts`'s (its trend-
 *     forecasting prediction shape, unrelated to ML cache-key prediction)
 *     aliased to `AnalyticsPrediction`.
 *   - `DependencyNode`: canonical in `cache-warmup.ts`, which defines it as
 *     part of a matched `DependencyGraph`/`DependencyNode`/`DependencyEdge`
 *     trio; `cache-invalidation.ts`'s standalone (differently-shaped)
 *     dependency-tracking type aliased to `InvalidationDependencyNode`.
 *
 * NO NEW NPM DEPENDENCIES: `lru-cache` (used by `smart-cache.ts`) was
 * already a real dependency from an earlier checkpoint. `lz4`/`zstd-codec`/
 * `snappy` (used by `cache-compression.ts` for optional faster codecs) are
 * all wrapped in `await import(...)` + `try/catch`, matching
 * `src/optimizer/tools/shared/optional-dependency.ts`'s own established
 * "gracefully degrade if absent" convention already used elsewhere in this
 * server -- not installed, not required to be. Every other cross-file
 * import (`../../core/cache-engine.js`, `../../core/token-counter.js`,
 * `../../core/metrics.js`, `../../core/types.js`'s `CacheInvalidationEvent`,
 * `../shared/hash-utils.js`'s `generateCacheKey`) already existed from
 * earlier checkpoints; nothing new needed adding there either.
 *
 * A REAL DEFECT FOUND AND FIXED, NOT SILENTLY REPLICATED: reading
 * `cache-replication.ts`'s and `cache-invalidation.ts`'s constructors
 * directly (not assumed from their `run()` methods) found that BOTH call an
 * unconditional background-timer starter from the CONSTRUCTOR itself --
 * `CacheReplicationTool`'s ctor calls `startBackgroundTasks()` (starting
 * `syncTimer`/`heartbeatTimer`/`healthCheckTimer`/`snapshotTimer` on a
 * 1s/5s/10s/5min cadence respectively) and `CacheInvalidationTool`'s ctor
 * calls `startScheduler()` (a 10s `schedulerTimer`) -- regardless of
 * whether `cache_replication`/`cache_invalidation` are ever actually
 * called. Vendor's own code never called `.unref()` on any of these,
 * meaning merely CONSTRUCTING either tool (which `createOptimizerRuntime()`
 * always does, for every optiflow-optimizer server process and every test
 * run of this file) kept the Node process alive forever on those
 * intervals -- a real production resource-leak bug, and one that would have
 * hung both `vitest` and the stdio smoke test's process exit the moment
 * this checkpoint's tools were constructed, not just when a specific
 * operation was called. Fixed live, matching this merge's own precedent for
 * real defects (the `defaultProjectRoot` fixes elsewhere): `.unref()`
 * called on each of these 4 timers immediately after creation (in
 * `cache-replication.ts`'s 4 `restartXTimer()` methods and
 * `cache-invalidation.ts`'s `startScheduler()`), plus the same fix applied
 * to `cache-invalidation.ts`'s on-demand, self-clearing `lazyProcessTimer`
 * and `smart-cache.ts`'s on-demand, self-clearing `writeBackTimer` (both
 * lower-severity since they're not constructor-started, but unref'd anyway
 * for the same reason). `.unref()` preserves every one of these tools' real
 * scheduled behavior whenever the process is alive for other reasons (e.g.
 * the real stdio MCP server, which stays alive on its own transport
 * regardless of these timers) while letting a short-lived process (tests,
 * the smoke-test script) exit naturally -- a real behavior difference from
 * vendor's (a process that used to hang now exits), not a capability loss.
 *
 * ONE REMAINING TEST-HARNESS HAZARD DOCUMENTED, NOT SILENTLY WORKED AROUND:
 * `cache-warmup.ts`'s `'schedule'` operation recursively re-arms a
 * self-clearing `setTimeout` chain (`scheduleNextRun`/`executeSchedule`) for
 * as long as a schedule remains active -- but ONLY when that specific
 * operation is explicitly invoked (verified: nothing in its constructor
 * starts anything). This checkpoint's own test suite (see
 * `server.test.ts`'s new `advanced-caching tools` block) deliberately
 * avoids calling `cache_warmup` with `operation: 'schedule'` for exactly
 * this reason -- a real, documented interaction for any FUTURE caller to be
 * aware of, not a defect this merge introduced or needed to fix (unlike the
 * two constructor-started cases above, nobody pays this cost by default).
 */

export {
  CacheAnalyticsTool,
  getCacheAnalyticsTool,
  CACHE_ANALYTICS_TOOL_DEFINITION,
  type CacheAnalyticsOptions,
  type CacheAnalyticsResult,
  type AnalyticsOperation,
  type TimeGranularity,
  type MetricType,
  type AggregationType,
  type ExportFormat,
  type HeatmapType,
  type DashboardData,
  // Aliased: differs from cache-optimizer.ts's own `PerformanceMetrics`
  // (already exported below under its own name).
  type PerformanceMetrics as AnalyticsPerformanceMetrics,
  type UsageMetrics,
  type EfficiencyMetrics,
  type CostMetrics,
  type HealthMetrics,
  type ActivityLog,
  type SizeDistribution,
  type EvictionPattern,
  type MetricCollection,
  type AggregatedMetrics,
  type TrendAnalysis,
  type TrendMetric,
  type Anomaly,
  // Aliased: differs from predictive-cache.ts's own `Prediction`
  // (already exported below under its own name).
  type Prediction as AnalyticsPrediction,
  type RegressionResult,
  type SeasonalityPattern,
  type Alert,
  type AlertConfiguration,
  type HeatmapData,
  type Bottleneck,
  type CostBreakdown,
  type StorageCost,
  type NetworkCost,
  type ComputeCost,
  type TotalCost,
  type CostProjection,
  type CostOptimization,
} from './cache-analytics.js';

export {
  CacheBenchmark,
  runCacheBenchmark,
  CACHE_BENCHMARK_TOOL_DEFINITION,
  type CacheBenchmarkOptions,
  type CacheBenchmarkResult,
  type CacheStrategy,
  type WorkloadType,
  type ReportFormat,
  type CacheConfig,
  type WorkloadConfig,
  type LatencyMetrics,
  type ThroughputMetrics,
  type BenchmarkResults,
  type ComparisonResult,
  type LoadTestResults,
} from './cache-benchmark.js';

export {
  CacheCompressionTool,
  runCacheCompression,
  CACHE_COMPRESSION_TOOL_DEFINITION,
  type CacheCompressionOptions,
  type CacheCompressionResult,
  type CompressionAlgorithm,
  type CompressionLevel,
  type DataType,
  type CompressionOperation,
  type CompressionAnalysis,
  type CompressionRecommendation,
  type BenchmarkResult,
  type CompressionConfig,
} from './cache-compression.js';

export {
  CacheInvalidationTool,
  getCacheInvalidationTool,
  CACHE_INVALIDATION_TOOL_DEFINITION,
  type CacheInvalidationOptions,
  type CacheInvalidationResult,
  type InvalidationStrategy,
  type InvalidationMode,
  // Aliased: differs from cache-warmup.ts's own `DependencyNode` (part of
  // that file's DependencyGraph/DependencyNode/DependencyEdge trio, already
  // exported below under its own name).
  type DependencyNode as InvalidationDependencyNode,
  type InvalidationRecord,
  type ScheduledInvalidation,
  type InvalidationStats,
} from './cache-invalidation.js';

export {
  CacheOptimizerTool,
  getCacheOptimizerTool,
  CACHE_OPTIMIZER_TOOL_DEFINITION,
  type CacheOptimizerOptions,
  type CacheOptimizerResult,
  // Aliased: differs from smart-cache.ts's own `EvictionStrategy`/
  // `CacheTier` (already exported below under their own names).
  type EvictionStrategy as OptimizerEvictionStrategy,
  type CacheTier as OptimizerCacheTier,
  type OptimizationObjective,
  type WorkloadPattern,
  type CacheConfiguration,
  type PerformanceMetrics,
  type StrategyBenchmark,
  type OptimizationRecommendation,
  type BottleneckAnalysis,
  type CostBenefitAnalysis,
  type SimulationResult,
  type SimulationEvent,
  type TuningResult,
  type OptimizationReport,
} from './cache-optimizer.js';

export {
  CachePartitionTool,
  getCachePartitionTool,
  CACHE_PARTITION_TOOL_DEFINITION,
  type CachePartitionOptions,
  type CachePartitionResult,
  type PartitionInfo,
  type MigrationPlan,
  type RebalanceResults,
  type ShardingConfig,
  type PartitionStatistics,
} from './cache-partition.js';

export {
  CacheReplicationTool,
  getCacheReplicationTool,
  CACHE_REPLICATION_TOOL_DEFINITION,
  type CacheReplicationOptions,
  type CacheReplicationResult,
  type ReplicationMode,
  type ConsistencyModel,
  type ConflictResolution,
  type NodeHealth,
  type ReplicationOperation,
  type ReplicaNode,
  type VectorClock,
  type ReplicationEntry,
  type SyncDelta,
  type Conflict,
  type ReplicationConfig,
  type HealthCheckResult,
  type ReplicationStats,
  type SnapshotMetadata,
} from './cache-replication.js';

export {
  CacheWarmupTool,
  getCacheWarmupTool,
  CACHE_WARMUP_TOOL_DEFINITION,
  type CacheWarmupOptions,
  type WarmupResult,
  type WarmupStrategy,
  type WarmupPriority,
  type WarmupStatus,
  type WarmupDataSource,
  type DependencyGraph,
  type DependencyNode,
  type DependencyEdge,
  type AccessHistoryEntry,
  type WarmupSchedule,
  type WarmupProgress,
  type WarmupError,
  // Aliased: differs from cache-optimizer.ts's own `SimulationResult`
  // (already exported above under its own name).
  type SimulationResult as WarmupSimulationResult,
  type WarmupConfiguration,
} from './cache-warmup.js';

export {
  PredictiveCacheTool,
  getPredictiveCacheTool,
  PREDICTIVE_CACHE_TOOL_DEFINITION,
  type PredictiveCacheOptions,
  type PredictiveCacheResult,
  type AccessPattern,
  type Prediction,
  type ModelMetrics,
} from './predictive-cache.js';

export {
  SmartCacheTool,
  getSmartCacheTool,
  SMART_CACHE_TOOL_DEFINITION,
  type SmartCacheOptions,
  type SmartCacheResult,
  type EvictionStrategy,
  type WriteMode,
  type CacheTier,
  type CacheEntryMetadata,
  type TierStats,
  type SmartCacheStats,
} from './smart-cache.js';
