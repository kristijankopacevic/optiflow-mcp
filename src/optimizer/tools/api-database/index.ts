/**
 * API & Database Tools
 *
 * All 10 tools below are real, compiling code with a genuine `get*(cache,
 * tokenCounter, metrics)` factory and a real dispatch case in vendor's own
 * `src/server/index.ts` (`case 'smart_xxx': { const options = args as any;
 * const result = await smartXxx.run(options); ... }` -- whole-args-object,
 * no positional destructuring, for every tool in this category). None of
 * them are the "Implementation pending" fixed-string stub pattern seen in
 * ../intelligence/index.ts.
 *
 * That said, direct inspection of each file (not just vendor's own category
 * index.ts, which is both stale -- missing several real `getSmartXxx`
 * factories confirmed present by reading the files directly -- and, per the
 * explicit re-exports below, was never checked for the type-name collisions
 * across its own files) found three different shades of "not fully real".
 * NOTE: this vendored tree is already a fork with real fixes applied on top
 * of upstream token-optimizer-mcp (see smart-env.ts's value-redaction fix
 * and smart-websocket.ts's real-connection fix elsewhere in this merge) --
 * "vendor's own comments" below describes this fork's current state, some
 * of which has already been hardened, not pristine upstream:
 *
 * - smart_database (smart-database.ts): every `DatabaseAction` --
 *   query/explain/analyze/optimize -- is explicitly marked by vendor's own
 *   "NOTE: Placeholder implementation / Real implementation would execute
 *   actual database query" comments and returns `Math.random()`-generated
 *   rows/plans/metrics, not a real database connection's output. There is
 *   no `pg`/`mysql2` (or any other live-DB) driver import in this file, so
 *   this remains a demo/shape-only tool today -- this is the one that has
 *   NOT yet had smart-schema's SQLite-reality fix applied to it.
 * - smart_migration (smart-migration.ts): entirely fabricated data -- it
 *   does not read any real migration files or directory from disk; every
 *   action (`list`/`status`/`pending`/`history`/`rollback`) synthesizes a
 *   fixed-shape fake result every call, per its own "NOTE: Placeholder for
 *   Phase 3 / Real implementation will query database for migration
 *   records" comments. This is the most stub-like tool in the category,
 *   though it's still wired upstream and its caching/token-reduction
 *   plumbing is real.
 * - smart_schema (smart-schema.ts): a genuine mixed case, already patched
 *   in this fork -- `introspectSQLite()` does REAL introspection via a real
 *   `better-sqlite3` connection (`pragma table_info`/`foreign_key_list`/
 *   `index_list`, real row counts, a schema-version hash of the actual
 *   schema), proven by this checkpoint's own test connecting to a real
 *   SQLite file and asserting its real table names come back.
 *   `introspectPostgreSQL()`/`introspectMySQL()` do NOT fabricate a schema
 *   (per that file's own comment, they used to invent ten fake tables and
 *   no longer do) -- they now throw an honest "PostgreSQL/MySQL
 *   introspection is not available: this package ships no
 *   PostgreSQL/MySQL driver" error instead, also proven by a test here.
 *   That is a materially better (and different) verdict than
 *   smart_database's silent fabrication: smart_schema either does the real
 *   thing or says plainly that it can't, never invents.
 *
 * The other 7 tools (smart_api_fetch, smart_cache_api, smart_graphql,
 * smart_orm, smart_rest, smart_sql, smart_websocket) do genuine static
 * analysis on the input actually given (SQL/GraphQL query text, endpoint
 * descriptions, ORM query logs) -- real regex-based parsing, N+1
 * detection, complexity scoring, caching-strategy planning -- with only
 * small, isolated pieces mocked because they'd otherwise require a live
 * external system this MCP tool has no connection to:
 * - smart_graphql's `introspectSchema()` (GraphQL introspection over an
 *   actual HTTP endpoint) returns a fixed mock `SchemaInfo` rather than
 *   issuing a real introspection query.
 * - smart_cache_api's `warmCache()` ("warm" action) records which URLs
 *   *would* be pre-fetched rather than actually fetching them.
 * - smart_sql's EXPLAIN-plan and query-history helpers synthesize
 *   plausible-looking cost/row estimates rather than talking to a real
 *   query planner.
 *
 * Ported and wired as-is (real, working code, faithfully reflecting this
 * fork's actual mock/real/honest-error split) -- not silently presented as
 * more real than it is. See the merge report for the per-tool detail.
 *
 * TYPE-NAME COLLISIONS: four type names are exported by more than one file
 * in this category (`QueryAnalysis` by smart-sql/smart-database/
 * smart-graphql; `MissingIndex` by smart-schema/smart-database;
 * `Optimization` by smart-sql/smart-database; `Relationship` by
 * smart-orm/smart-schema) -- a bare `export *` for all ten files is a
 * TS2308 compile error here (unlike every prior category's index.ts, none
 * of which has this collision). Resolved below with the same aliasing
 * convention vendor's own (incomplete) category index.ts already
 * established for the collisions it did know about (`Sql`/`Database`/
 * `GraphQL` prefixes for `QueryAnalysis`; `Schema`/`Database` prefixes for
 * `MissingIndex`; a `Database` prefix for `Optimization`), plus one new
 * alias (`OrmRelationship`) for the `Relationship` collision vendor's own
 * index.ts never surfaced because it never re-exported smart-orm's
 * `Relationship` in the first place.
 */

export {
  SmartApiFetch,
  getSmartApiFetch,
  runSmartApiFetch,
  SMART_API_FETCH_TOOL_DEFINITION,
} from './smart-api-fetch.js';

export {
  SmartCacheAPI,
  getSmartCacheApi,
  runSmartCacheApi,
  SMART_CACHE_API_TOOL_DEFINITION,
  type APIRequest,
  type CachedResponse,
  type CachingStrategy,
  type InvalidationPattern,
  type SmartCacheAPIOptions,
  type SmartCacheAPIResult,
  type CacheAnalysis,
} from './smart-cache-api.js';

export {
  SmartDatabase,
  getSmartDatabase,
  runSmartDatabase,
  SMART_DATABASE_TOOL_DEFINITION,
  type DatabaseAction,
  type DatabaseEngine,
  type QueryType,
  type SmartDatabaseOptions,
  type QueryResult,
  type FieldInfo,
  type QueryPlan,
  type QueryPlanStep,
  type QueryAnalysis as DatabaseQueryAnalysis,
  type MissingIndex as DatabaseMissingIndex,
  type Optimization as DatabaseOptimization,
  type HealthMetrics,
  type PoolInfo,
  type SlowQuery,
  type BatchResult,
  type SmartDatabaseResult,
  type SmartDatabaseOutput,
} from './smart-database.js';

export {
  SmartORM,
  getSmartOrm,
  runSmartORM,
  SMART_ORM_TOOL_DEFINITION,
  type ORMType,
  type SmartORMOptions,
  type Relationship as OrmRelationship,
  type N1Instance,
  type EagerLoadingSuggestion,
  type QueryReduction,
  type IndexSuggestion,
  type SmartORMResult,
} from './smart-orm.js';

export {
  SmartREST,
  getSmartRest,
  runSmartREST,
  SMART_REST_TOOL_DEFINITION,
  type SmartRESTOptions,
  type EndpointInfo,
  type ResourceGroup,
  type HealthIssue,
  type RateLimit,
  type SmartRESTResult,
} from './smart-rest.js';

export {
  SmartSchema,
  getSmartSchema,
  runSmartSchema,
  SMART_SCHEMA_TOOL_DEFINITION,
  type SmartSchemaOptions,
  type DatabaseSchema,
  type TableInfo,
  type ColumnInfo,
  type ViewInfo,
  type IndexInfo,
  type ConstraintInfo,
  type Relationship,
  type RelationshipGraph,
  type CircularDependency,
  type SchemaAnalysis,
  type SchemaIssue,
  type MissingIndex as SchemaMissingIndex,
  type SchemaDiff,
  type SmartSchemaResult,
  type SmartSchemaOutput,
} from './smart-schema.js';

export {
  SmartSql,
  getSmartSql,
  runSmartSql,
  SMART_SQL_TOOL_DEFINITION,
  type SmartSqlOptions,
  type QueryAnalysis as SqlQueryAnalysis,
  type ExecutionPlanStep,
  type ExecutionPlan,
  type OptimizationSuggestion,
  type Optimization,
  type ValidationError,
  type Validation,
  type HistoryEntry,
  type SmartSqlOutput,
} from './smart-sql.js';

export {
  SmartMigration,
  getSmartMigration,
  runSmartMigration,
  SMART_MIGRATION_TOOL_DEFINITION,
  type MigrationAction,
  type MigrationStatus,
  type MigrationDirection,
  type SmartMigrationOptions,
  type Migration,
  type MigrationStatusSummary,
  type MigrationHistoryEntry,
  type RollbackResult,
  type GeneratedMigration,
  type SmartMigrationResult,
  type SmartMigrationOutput,
} from './smart-migration.js';

export {
  SmartWebSocket,
  getSmartWebSocket,
  runSmartWebSocket,
  SMART_WEBSOCKET_TOOL_DEFINITION,
  type SmartWebSocketOptions,
  type Message,
  type MessageType,
  type SmartWebSocketResult,
} from './smart-websocket.js';

export {
  SmartGraphQL,
  getSmartGraphQL,
  runSmartGraphQL,
  SMART_GRAPHQL_TOOL_DEFINITION,
  type SmartGraphQLOptions,
  type SmartGraphQLResult,
  type ComplexityMetrics,
  type FragmentSuggestion,
  type FieldReduction,
  type BatchOpportunity,
  type N1Problem,
  type QueryAnalysis as GraphQLQueryAnalysis,
  type Optimizations,
  type SchemaInfo,
} from './smart-graphql.js';
