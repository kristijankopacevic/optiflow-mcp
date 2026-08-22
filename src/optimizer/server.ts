#!/usr/bin/env node
// optiflow's own MCP server for the merged optimizer tools (ported from
// vendor/token-optimizer-mcp, MIT-licensed — see THIRD_PARTY_LICENSES.md).
//
// SCOPE (see the merge plan's Phase 5 gate — this grows incrementally,
// checkpoint by checkpoint, NOT all at once): a real, working optiflow-owned
// MCP server, currently wired to file-operations (smart_read/write/edit/
// glob/grep/status/diff/log/branch/merge), configuration (smart_env/
// package_json/config_read/tsconfig/workflow), output-formatting
// (smart_pretty), system-operations (smart_process/service/cron/user),
// intelligence (knowledge_graph/sentiment_analysis/wiki_read/wiki_write),
// api-database (smart_api_fetch/cache_api/database/graphql/migration/
// orm/rest/schema/sql/websocket — see
// src/optimizer/tools/api-database/index.ts for which of these do real
// analysis vs. vendor's own mocked/placeholder pieces), build-systems
// (smart_build/docker/install/lint/logs/network/processes/system_metrics/
// test/typecheck — see src/optimizer/tools/build-systems/index.ts for the
// Windows CVE-2024-27980 spawn workaround five of these already carried,
// and for a known projectRoot-staleness divergence across three of them
// that was ported as-is rather than silently patched), and code-analysis
// (8 of 9 real tools wired: smart_ast_grep/security/dependencies/
// complexity/refactor/imports/exports/symbols — see
// src/optimizer/tools/code-analysis/index.ts's header for the full
// explanation, but in short: 6 of these 9 originally
// `import * as ts from 'typescript'` for the classic Compiler API
// (createSourceFile, SyntaxKind, node type guards, ...), which this repo's
// typescript@^7.0.2 (the native/Go-rewritten compiler) no longer ships
// under its public exports at all. This checkpoint resolved that by
// porting 5 of those 6 (complexity/refactor/imports/exports were pure
// syntax-level analysis with no capability loss; symbols lost exactly two
// fields -- `type`/`references`, both genuinely type-checker-dependent,
// removed rather than approximated, see smart-symbols.ts's own header) to
// `@babel/parser` + a hand-written `@babel/types`-`VISITOR_KEYS` walk
// (see code-analysis/babel-ast-utils.ts's header for why not
// `@babel/traverse`). The 6th, smart_typescript, stays deferred: its
// entire output IS type-check diagnostics from a real type checker, which
// a syntax-only parser has no honest substitute for (see its own file's
// header). Of the 3 wired earlier: smart_security had the same
// projectRoot-staleness bug class checkpoint 4 found in build-systems,
// fixed live at that time; smart_dependencies also got a real dependency
// substitution
// (@typescript-eslint/typescript-estree dropped for the same TS-7 peer
// conflict, replaced by routing its parsing entirely through the
// already-added @babel/parser) and a vendor dispatch-shape improvement
// (its own free-function CLI helper's double-JSON-encoding-a-string defect
// is not replicated; dispatched via a shared instance like every other
// category here instead) -- smart_symbols gets the same dispatch-shape
// improvement now (vendor's `runSmartSymbols` returns a pre-formatted
// report string that vendor's own dispatch re-JSON.stringifies; this
// dispatches via the shared instance's `.run(args)` instead, a real result
// object). advanced-caching (this checkpoint) is now FULLY wired — all 10
// real tools (smart_cache/predictive_cache/cache_warmup/cache_analytics/
// cache_benchmark/cache_compression/cache_invalidation/cache_optimizer/
// cache_partition/cache_replication), zero deferrals — see
// src/optimizer/tools/advanced-caching/index.ts's header for: the
// dual-signal dispatch verification (vendor's own category index.ts
// under-reports this one exactly like it did for build-systems, exporting
// only 2 of the 10 real tools), why nothing here needed an
// architectural-mismatch deferral (no real network/distributed backend
// despite the replication/partition vocabulary — pure in-process
// simulation over the shared CacheEngine), the one new paths.ts helper this
// category genuinely needed (getOptimizerReportsDir, for
// cache-benchmark.ts's report-file output), the six cross-file type-name
// collisions resolved via aliased re-exports, and the two vendor
// dispatch-shape defects (cache_compression's module-singleton stale
// CacheEngine; cache_benchmark's double-JSON-encoded string result) not
// replicated here, matching the same "dispatch via a directly-constructed
// shared instance instead" fix already applied to smart_symbols. analytics
// (this checkpoint) is now FULLY wired — all 5 real tools
// (get_hook_analytics/get_action_analytics/get_mcp_server_analytics/
// export_analytics/get_optimization_report), the category an earlier
// checkpoint explicitly deferred because its whole dependency —
// src/optimizer/analytics/ (ported this checkpoint, a sibling of
// src/optimizer/core/, NOT a tools/ category — see that directory's own
// per-file headers) — didn't exist yet. See
// src/optimizer/tools/analytics/index.ts's header for the dispatch-shape
// finding (pre-formatted JSON-string return, dispatched via a dedicated
// `okPreformatted()` instead of the generic `ok()`) and
// src/optimizer/analytics/record-tool-analytics.ts's header plus this
// function's own comment above the `rawRegistry` → `registry` wrapping loop
// for the real architectural decision: EVERY tool call (not just the 5
// analytics tools) is now recorded via `recordToolAnalytics()`, matching
// vendor's real "one place every tool result passes through" breadth,
// in an honest no-fabricated-savings degraded mode (no
// discloseResult()/mcpEvidence baseline pipeline ported — out of scope).
// dashboard-monitoring (this checkpoint) is now 9 of 10 real tools wired
// (alert_manager/custom_widget/data_visualizer/health_monitor/log_dashboard/
// metric_collector/monitoring_integration/performance-tracker/
// smart-dashboard) -- see src/optimizer/tools/dashboard-monitoring/index.ts's
// header for: the dual-signal dispatch verification (7 of the 10 confirmed
// via vendor's real src/server/index.ts dispatch, matching this merge's
// established shared-instance `.run(options)` convention exactly); the
// non-vendor-dispatched-but-still-wired precedent applied to
// performance-tracker/smart-dashboard (matching smart_workflow/
// knowledge_graph/sentiment_analysis's own precedent -- a real, complete,
// compiling tool definition is the wiring bar here, not whether vendor's own
// server happened to dispatch it); the one genuinely deferred tool,
// report-generator (no name/inputSchema/factory anywhere in that file --
// nothing to wire without inventing a schema, unlike smart_typescript's
// "complete tool vendor never dispatched" precedent); the real hyphenated-
// name mismatch on performance-tracker/smart-dashboard's own tool
// definitions (ported as-is, not silently renamed to fit every other tool's
// underscore convention); and the five-plus-two type-name collisions
// resolved via aliased re-exports (smart-dashboard.ts is a near-verbatim
// clone of health-monitor.ts's health-check subsystem).
//
// A DEAD END DOCUMENTED, NOT PORTED: output-formatting's other 6 vendor
// files (smart-diff/smart-export/smart-format/smart-log/smart-report/
// smart-stream.ts, beyond the already-merged smart-pretty.ts) were
// evaluated for this same checkpoint and found to be genuinely unportable,
// not merely deferred -- verified directly, not assumed: `smart-export.ts`/
// `smart-format.ts`/`smart-report.ts` are literally ONE LINE (a header
// comment only, zero code, matching vendor's own category index.ts note
// "Implementation pending"); `smart-diff.ts`/`smart-log.ts`/
// `smart-stream.ts` have substantial `SmartDiff`/`SmartLog`/`SmartStream`
// classes but every one is a TRUNCATED, non-compilable fragment -- each
// ends mid-statement on the identical phrase "// measured, not assumed: a
// multiplier here would invent a saving" with zero `import` lines, not a
// complete file. None of the 6 has an exported `TOOL_DEFINITION`/schema or
// factory function, and none is dispatched anywhere in vendor's real
// server -- in fact vendor's real dispatch for `case 'smart_diff'`/
// `case 'smart_log'` explicitly constructs and calls the DIFFERENT,
// already-merged file-operations `SmartDiff`/`SmartLog` classes instead, so
// even wiring these under their own literal names would collide with tools
// that already exist and are already correct. output-formatting's real,
// complete state is therefore unchanged at 1 tool (smart_pretty) -- no new
// files were copied in for it this checkpoint.
// It replaces
// token-optimizer-mcp's own
// ~3000-line `src/server/index.ts` (a single giant switch-statement dispatch
// entangled with ~50 other modules — analytics, dashboard, UCR, wiki — that
// are copied-but-not-yet-wired) with a small, real dispatch table built
// directly from the ported tool classes' own `get*Tool()` factories, one
// shared CacheEngine/TokenCounter/MetricsCollector instance, and each tool's
// own already-exported `*_TOOL_DEFINITION` schema constant. Every dispatch
// case here matches the ACTUAL behavior of the equivalent case in vendor's
// `src/server/index.ts` (verified by reading it — see the case-by-case
// comments below) rather than being reinvented.
//
// Server identity: vendor's hardcoded `name: 'token-optimizer-mcp'` becomes
// optiflow's own name below.

import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { CacheEngine } from "./core/cache-engine.js";
import { TokenCounter } from "./core/token-counter.js";
import { MetricsCollector } from "./core/metrics.js";

import { getSmartReadTool, SMART_READ_TOOL_DEFINITION } from "./tools/file-operations/smart-read.js";
import { getSmartWriteTool, SMART_WRITE_TOOL_DEFINITION } from "./tools/file-operations/smart-write.js";
import { getSmartEditTool, SMART_EDIT_TOOL_DEFINITION } from "./tools/file-operations/smart-edit.js";
import { getSmartGlobTool, SMART_GLOB_TOOL_DEFINITION } from "./tools/file-operations/smart-glob.js";
import { getSmartGrepTool, SMART_GREP_TOOL_DEFINITION } from "./tools/file-operations/smart-grep.js";
import { getSmartStatusTool, SMART_STATUS_TOOL_DEFINITION } from "./tools/file-operations/smart-status.js";
import { getSmartDiffTool, SMART_DIFF_TOOL_DEFINITION } from "./tools/file-operations/smart-diff.js";
import { getSmartLogTool, SMART_LOG_TOOL_DEFINITION } from "./tools/file-operations/smart-log.js";
import { getSmartBranchTool, SMART_BRANCH_TOOL_DEFINITION } from "./tools/file-operations/smart-branch.js";
import { getSmartMergeTool, SMART_MERGE_TOOL_DEFINITION } from "./tools/file-operations/smart-merge.js";

import { getSmartEnv, SMART_ENV_TOOL_DEFINITION } from "./tools/configuration/smart-env.js";
import { getSmartPackageJson, SMART_PACKAGE_JSON_TOOL_DEFINITION } from "./tools/configuration/smart-package-json.js";
import { getSmartConfigReadTool, SMART_CONFIG_READ_TOOL_DEFINITION } from "./tools/configuration/smart-config-read.js";
import { getSmartTsConfig, SMART_TSCONFIG_TOOL_DEFINITION } from "./tools/configuration/smart-tsconfig.js";
import { getSmartWorkflowTool, SMART_WORKFLOW_TOOL_DEFINITION } from "./tools/configuration/smart-workflow.js";
import { getSmartPretty, SMART_PRETTY_TOOL_DEFINITION } from "./tools/output-formatting/smart-pretty.js";

import { getSmartProcess, SMART_PROCESS_TOOL_DEFINITION } from "./tools/system-operations/smart-process.js";
import { getSmartService, SMART_SERVICE_TOOL_DEFINITION } from "./tools/system-operations/smart-service.js";
import { getSmartCron, SMART_CRON_TOOL_DEFINITION } from "./tools/system-operations/smart-cron.js";
import { getSmartUser, SMART_USER_TOOL_DEFINITION } from "./tools/system-operations/smart-user.js";

import { getKnowledgeGraphTool, KNOWLEDGE_GRAPH_TOOL_DEFINITION } from "./tools/intelligence/knowledge-graph.js";
import { getSentimentAnalysisTool, SENTIMENT_ANALYSIS_TOOL_DEFINITION } from "./tools/intelligence/sentiment-analysis.js";
import { wikiRead, WIKI_READ_TOOL_DEFINITION } from "./tools/intelligence/wiki-read.js";
import { wikiWrite, WIKI_WRITE_TOOL_DEFINITION } from "./tools/intelligence/wiki-write.js";

import { getSmartApiFetch, SMART_API_FETCH_TOOL_DEFINITION } from "./tools/api-database/smart-api-fetch.js";
import { getSmartCacheApi, SMART_CACHE_API_TOOL_DEFINITION } from "./tools/api-database/smart-cache-api.js";
import { getSmartDatabase, SMART_DATABASE_TOOL_DEFINITION } from "./tools/api-database/smart-database.js";
import { getSmartGraphQL, SMART_GRAPHQL_TOOL_DEFINITION } from "./tools/api-database/smart-graphql.js";
import { getSmartMigration, SMART_MIGRATION_TOOL_DEFINITION } from "./tools/api-database/smart-migration.js";
import { getSmartOrm, SMART_ORM_TOOL_DEFINITION } from "./tools/api-database/smart-orm.js";
import { getSmartRest, SMART_REST_TOOL_DEFINITION } from "./tools/api-database/smart-rest.js";
import { getSmartSchema, SMART_SCHEMA_TOOL_DEFINITION } from "./tools/api-database/smart-schema.js";
import { getSmartSql, SMART_SQL_TOOL_DEFINITION } from "./tools/api-database/smart-sql.js";
import { getSmartWebSocket, SMART_WEBSOCKET_TOOL_DEFINITION } from "./tools/api-database/smart-websocket.js";

// code-analysis: 8 of 9 real tools are now wired -- see
// src/optimizer/tools/code-analysis/index.ts's header for the full port
// history (classic TS Compiler API -> @babel/parser, this checkpoint).
// Only smart_typescript stays deferred (see its own file's header: its
// entire output IS type-check diagnostics from a real type checker, which
// a syntax-only parser cannot honestly substitute) and stays excluded from
// tsconfig.json's compile graph.
import { getSmartAstGrepTool, SMART_AST_GREP_TOOL_DEFINITION } from "./tools/code-analysis/smart-ast-grep.js";
import { getSmartSecurityTool, SMART_SECURITY_TOOL_DEFINITION } from "./tools/code-analysis/smart-security.js";
import { getSmartDependenciesTool, SMART_DEPENDENCIES_TOOL_DEFINITION } from "./tools/code-analysis/smart-dependencies.js";
import { getSmartComplexityTool, SMART_COMPLEXITY_TOOL_DEFINITION } from "./tools/code-analysis/smart-complexity.js";
import { getSmartRefactorTool, SMART_REFACTOR_TOOL_DEFINITION } from "./tools/code-analysis/smart-refactor.js";
import { getSmartImportsTool, SMART_IMPORTS_TOOL_DEFINITION } from "./tools/code-analysis/smart-imports.js";
import { getSmartExportsTool, SMART_EXPORTS_TOOL_DEFINITION } from "./tools/code-analysis/smart-exports.js";
import { getSmartSymbolsTool, SMART_SYMBOLS_TOOL_DEFINITION } from "./tools/code-analysis/smart-symbols.js";

// advanced-caching: all 10 real tools wired -- see
// src/optimizer/tools/advanced-caching/index.ts's header for the full
// dual-signal dispatch verification (vendor's own category index.ts
// under-reports this one just like build-systems did), the zero-deferral
// finding (no projectRoot bug class, no live-network/distributed-backend
// mismatch), the one genuinely new paths.ts helper this category needed
// (getOptimizerReportsDir), and the six cross-file type-name collisions
// resolved via aliased re-exports.
import { getCacheAnalyticsTool, CACHE_ANALYTICS_TOOL_DEFINITION } from "./tools/advanced-caching/cache-analytics.js";
import { CacheBenchmark, CACHE_BENCHMARK_TOOL_DEFINITION } from "./tools/advanced-caching/cache-benchmark.js";
import { CacheCompressionTool, CACHE_COMPRESSION_TOOL_DEFINITION } from "./tools/advanced-caching/cache-compression.js";
import { getCacheInvalidationTool, CACHE_INVALIDATION_TOOL_DEFINITION } from "./tools/advanced-caching/cache-invalidation.js";
import { getCacheOptimizerTool, CACHE_OPTIMIZER_TOOL_DEFINITION } from "./tools/advanced-caching/cache-optimizer.js";
import { getCachePartitionTool, CACHE_PARTITION_TOOL_DEFINITION } from "./tools/advanced-caching/cache-partition.js";
import { getCacheReplicationTool, CACHE_REPLICATION_TOOL_DEFINITION } from "./tools/advanced-caching/cache-replication.js";
import { getCacheWarmupTool, CACHE_WARMUP_TOOL_DEFINITION } from "./tools/advanced-caching/cache-warmup.js";
import { getPredictiveCacheTool, PREDICTIVE_CACHE_TOOL_DEFINITION } from "./tools/advanced-caching/predictive-cache.js";
import { getSmartCacheTool, SMART_CACHE_TOOL_DEFINITION } from "./tools/advanced-caching/smart-cache.js";

// analytics: all 5 real tools wired (get_hook_analytics/get_action_analytics/
// get_mcp_server_analytics/export_analytics/get_optimization_report) -- see
// src/optimizer/tools/analytics/index.ts's header for the dispatch-shape
// finding (pre-formatted JSON-string return, not an object -- dispatched via
// a dedicated `okPreformatted()` below, not the generic `ok()` every other
// category uses) and src/optimizer/analytics/record-tool-analytics.ts's own
// header for the Part-1 architectural decision (every registry entry gets
// wrapped with analytics recording, matching vendor's real "one place every
// tool result passes through" breadth, in an honest no-fabricated-savings
// degraded mode -- no discloseResult()/mcpEvidence baseline pipeline exists
// yet).
import { getHookAnalyticsTool, GET_HOOK_ANALYTICS_TOOL_DEFINITION } from "./tools/analytics/get-hook-analytics.js";
import { getActionAnalyticsTool, GET_ACTION_ANALYTICS_TOOL_DEFINITION } from "./tools/analytics/get-action-analytics.js";
import { getMcpServerAnalyticsTool, GET_MCP_SERVER_ANALYTICS_TOOL_DEFINITION } from "./tools/analytics/get-mcp-server-analytics.js";
import { getExportAnalyticsTool, EXPORT_ANALYTICS_TOOL_DEFINITION } from "./tools/analytics/export-analytics.js";
import { getOptimizationReportTool, GET_OPTIMIZATION_REPORT_TOOL_DEFINITION } from "./tools/analytics/get-optimization-report.js";
import { AnalyticsManager } from "./analytics/analytics-manager.js";
import { recordToolAnalytics } from "./analytics/record-tool-analytics.js";

import { getSmartBuildTool, SMART_BUILD_TOOL_DEFINITION } from "./tools/build-systems/smart-build.js";
import { getSmartDocker, SMART_DOCKER_TOOL_DEFINITION } from "./tools/build-systems/smart-docker.js";
import { getSmartInstall, SMART_INSTALL_TOOL_DEFINITION } from "./tools/build-systems/smart-install.js";
import { getSmartLintTool, SMART_LINT_TOOL_DEFINITION } from "./tools/build-systems/smart-lint.js";
import { getSmartLogs, SMART_LOGS_TOOL_DEFINITION } from "./tools/build-systems/smart-logs.js";
import { getSmartNetwork, SMART_NETWORK_TOOL_DEFINITION } from "./tools/build-systems/smart-network.js";
import { getSmartProcessesTool, SMART_PROCESSES_TOOL_DEFINITION } from "./tools/build-systems/smart-processes.js";
import { getSmartSystemMetrics, SMART_SYSTEM_METRICS_TOOL_DEFINITION } from "./tools/build-systems/smart-system-metrics.js";
import { getSmartTestTool, SMART_TEST_TOOL_DEFINITION } from "./tools/build-systems/smart-test.js";
import { getSmartTypeCheckTool, SMART_TYPECHECK_TOOL_DEFINITION } from "./tools/build-systems/smart-typecheck.js";

// dashboard-monitoring: 9 of 10 real tools wired -- see
// src/optimizer/tools/dashboard-monitoring/index.ts's header for the
// dual-signal dispatch verification, the non-vendor-dispatched-but-wired
// precedent applied to performance-tracker/smart-dashboard, and the one
// deferred tool (report-generator, no schema to wire).
import { getAlertManager, ALERT_MANAGER_TOOL_DEFINITION } from "./tools/dashboard-monitoring/alert-manager.js";
import { getCustomWidget, CUSTOM_WIDGET_TOOL_DEFINITION } from "./tools/dashboard-monitoring/custom-widget.js";
import { getDataVisualizer, DATA_VISUALIZER_TOOL_DEFINITION } from "./tools/dashboard-monitoring/data-visualizer.js";
import { getHealthMonitor, HEALTH_MONITOR_TOOL_DEFINITION } from "./tools/dashboard-monitoring/health-monitor.js";
import { getLogDashboard, LOG_DASHBOARD_TOOL_DEFINITION } from "./tools/dashboard-monitoring/log-dashboard.js";
import { getMetricCollector, METRIC_COLLECTOR_TOOL_DEFINITION } from "./tools/dashboard-monitoring/metric-collector.js";
import { getMonitoringIntegration, MONITORING_INTEGRATION_TOOL_DEFINITION } from "./tools/dashboard-monitoring/monitoring-integration.js";
import { createPerformanceTracker, performanceTrackerTool } from "./tools/dashboard-monitoring/performance-tracker.js";
import { createSmartDashboard, smartDashboardTool } from "./tools/dashboard-monitoring/smart-dashboard.js";
// Optiflow's own tool (not vendored from token-optimizer-mcp, hence the
// path outside ./tools/) -- see src/native/ccr-tool.ts's header.
import { CCR_RETRIEVE_TOOL_DEFINITION, runCcrRetrieveTool } from "../native/ccr-tool.js";

/** All tools currently wired into the dispatch table (not just copied-in). */
export const ALL_TOOL_DEFINITIONS: Tool[] = [
  SMART_READ_TOOL_DEFINITION,
  SMART_WRITE_TOOL_DEFINITION,
  SMART_EDIT_TOOL_DEFINITION,
  SMART_GLOB_TOOL_DEFINITION,
  SMART_GREP_TOOL_DEFINITION,
  SMART_STATUS_TOOL_DEFINITION,
  SMART_DIFF_TOOL_DEFINITION,
  SMART_LOG_TOOL_DEFINITION,
  SMART_BRANCH_TOOL_DEFINITION,
  SMART_MERGE_TOOL_DEFINITION,
  SMART_ENV_TOOL_DEFINITION,
  SMART_PACKAGE_JSON_TOOL_DEFINITION,
  SMART_CONFIG_READ_TOOL_DEFINITION,
  SMART_TSCONFIG_TOOL_DEFINITION,
  SMART_WORKFLOW_TOOL_DEFINITION,
  SMART_PRETTY_TOOL_DEFINITION,
  SMART_PROCESS_TOOL_DEFINITION,
  SMART_SERVICE_TOOL_DEFINITION,
  SMART_CRON_TOOL_DEFINITION,
  SMART_USER_TOOL_DEFINITION,
  KNOWLEDGE_GRAPH_TOOL_DEFINITION,
  SENTIMENT_ANALYSIS_TOOL_DEFINITION,
  WIKI_READ_TOOL_DEFINITION,
  WIKI_WRITE_TOOL_DEFINITION,
  SMART_API_FETCH_TOOL_DEFINITION,
  SMART_CACHE_API_TOOL_DEFINITION,
  SMART_DATABASE_TOOL_DEFINITION,
  SMART_GRAPHQL_TOOL_DEFINITION,
  SMART_MIGRATION_TOOL_DEFINITION,
  SMART_ORM_TOOL_DEFINITION,
  SMART_REST_TOOL_DEFINITION,
  SMART_SCHEMA_TOOL_DEFINITION,
  SMART_SQL_TOOL_DEFINITION,
  SMART_WEBSOCKET_TOOL_DEFINITION,
  SMART_BUILD_TOOL_DEFINITION,
  SMART_DOCKER_TOOL_DEFINITION,
  SMART_INSTALL_TOOL_DEFINITION,
  SMART_LINT_TOOL_DEFINITION,
  SMART_LOGS_TOOL_DEFINITION,
  SMART_NETWORK_TOOL_DEFINITION,
  SMART_PROCESSES_TOOL_DEFINITION,
  SMART_SYSTEM_METRICS_TOOL_DEFINITION,
  SMART_TEST_TOOL_DEFINITION,
  SMART_TYPECHECK_TOOL_DEFINITION,
  SMART_AST_GREP_TOOL_DEFINITION,
  SMART_SECURITY_TOOL_DEFINITION,
  SMART_DEPENDENCIES_TOOL_DEFINITION,
  SMART_COMPLEXITY_TOOL_DEFINITION,
  SMART_REFACTOR_TOOL_DEFINITION,
  SMART_IMPORTS_TOOL_DEFINITION,
  SMART_EXPORTS_TOOL_DEFINITION,
  SMART_SYMBOLS_TOOL_DEFINITION,
  CACHE_ANALYTICS_TOOL_DEFINITION,
  CACHE_BENCHMARK_TOOL_DEFINITION,
  CACHE_COMPRESSION_TOOL_DEFINITION,
  CACHE_INVALIDATION_TOOL_DEFINITION,
  CACHE_OPTIMIZER_TOOL_DEFINITION,
  CACHE_PARTITION_TOOL_DEFINITION,
  CACHE_REPLICATION_TOOL_DEFINITION,
  CACHE_WARMUP_TOOL_DEFINITION,
  PREDICTIVE_CACHE_TOOL_DEFINITION,
  SMART_CACHE_TOOL_DEFINITION,
  GET_HOOK_ANALYTICS_TOOL_DEFINITION,
  GET_ACTION_ANALYTICS_TOOL_DEFINITION,
  GET_MCP_SERVER_ANALYTICS_TOOL_DEFINITION,
  EXPORT_ANALYTICS_TOOL_DEFINITION,
  GET_OPTIMIZATION_REPORT_TOOL_DEFINITION,
  ALERT_MANAGER_TOOL_DEFINITION,
  CUSTOM_WIDGET_TOOL_DEFINITION,
  DATA_VISUALIZER_TOOL_DEFINITION,
  HEALTH_MONITOR_TOOL_DEFINITION,
  LOG_DASHBOARD_TOOL_DEFINITION,
  METRIC_COLLECTOR_TOOL_DEFINITION,
  MONITORING_INTEGRATION_TOOL_DEFINITION,
  performanceTrackerTool,
  smartDashboardTool,
  // Tool 77: optiflow's own, everything above is vendored.
  CCR_RETRIEVE_TOOL_DEFINITION,
] as unknown as Tool[];

export interface ToolCallResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function ok(result: unknown): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

/**
 * For the analytics category's 5 tools, whose factories return an
 * ALREADY-JSON-stringified string (verified against vendor's real dispatch --
 * see src/optimizer/tools/analytics/index.ts's header). Using `ok()` here
 * would double-encode the string, the same defect class checkpoints 6/7
 * found in `runSmartSymbols`/`runCacheBenchmark` and did not replicate.
 */
function okPreformatted(text: string): ToolCallResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(error: unknown): ToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      },
    ],
    isError: true,
  };
}

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<ToolCallResult>;

export interface OptimizerRuntime {
  registry: Record<string, ToolHandler>;
  cache: CacheEngine;
  /** Releases the underlying SQLite handle(s) -- `cache`'s own `cache.db`
   * AND (new in this checkpoint) the analytics manager's separate
   * `analytics.db` (`AnalyticsManager`/`SqliteAnalyticsStorage` open their
   * own independent `better-sqlite3` handle, not `cache`'s). Callers (tests
   * especially, since Windows won't let a temp dir be removed while either
   * database is still open) must call this when done with the runtime. Now
   * async (was sync) because flushing the analytics manager's pending
   * batched writes on close is itself async. */
  close: () => Promise<void>;
}

/**
 * Builds the shared tool instances plus the name -> handler dispatch table.
 * Exported (rather than only constructed inside `main()`) so tests can
 * exercise real dispatch without spawning a stdio process, per the
 * "direct handler invocation" fallback the merge plan allows.
 */
export function createOptimizerRuntime(): OptimizerRuntime {
  const cache = new CacheEngine();
  const tokenCounter = new TokenCounter();
  const metrics = new MetricsCollector();

  const smartRead = getSmartReadTool(cache, tokenCounter, metrics);
  const smartWrite = getSmartWriteTool(cache, tokenCounter, metrics);
  const smartEdit = getSmartEditTool(cache, tokenCounter, metrics);
  const smartGlob = getSmartGlobTool(cache, tokenCounter, metrics);
  const smartGrep = getSmartGrepTool(cache, tokenCounter, metrics);
  const smartStatus = getSmartStatusTool(cache, tokenCounter, metrics);
  const smartDiff = getSmartDiffTool(cache, tokenCounter, metrics);
  const smartLog = getSmartLogTool(cache, tokenCounter, metrics);
  const smartBranch = getSmartBranchTool(cache, tokenCounter, metrics);
  const smartMerge = getSmartMergeTool(cache, tokenCounter, metrics);

  const smartEnv = getSmartEnv(cache, tokenCounter, metrics);
  const smartPackageJson = getSmartPackageJson(cache, tokenCounter, metrics);
  const smartConfigRead = getSmartConfigReadTool(cache, tokenCounter, metrics);
  const smartTsConfig = getSmartTsConfig(cache, tokenCounter, metrics);
  const smartWorkflow = getSmartWorkflowTool(cache, tokenCounter, metrics);
  const smartPretty = getSmartPretty(cache, tokenCounter, metrics);

  const smartProcess = getSmartProcess(cache, tokenCounter, metrics);
  const smartService = getSmartService(cache, tokenCounter, metrics);
  const smartCron = getSmartCron(cache, tokenCounter, metrics);
  const smartUser = getSmartUser(cache, tokenCounter, metrics);

  const knowledgeGraph = getKnowledgeGraphTool(cache, tokenCounter, metrics);
  const sentimentAnalysis = getSentimentAnalysisTool(cache, tokenCounter, metrics);

  const smartApiFetch = getSmartApiFetch(cache, tokenCounter, metrics);
  const smartCacheApi = getSmartCacheApi(cache, tokenCounter, metrics);
  const smartDatabase = getSmartDatabase(cache, tokenCounter, metrics);
  const smartGraphQL = getSmartGraphQL(cache, tokenCounter, metrics);
  const smartMigration = getSmartMigration(cache, tokenCounter, metrics);
  const smartOrm = getSmartOrm(cache, tokenCounter, metrics);
  const smartRest = getSmartRest(cache, tokenCounter, metrics);
  const smartSchema = getSmartSchema(cache, tokenCounter, metrics);
  const smartSql = getSmartSql(cache, tokenCounter, metrics);
  const smartWebSocket = getSmartWebSocket(cache, tokenCounter, metrics);

  // build-systems: instantiated with the SAME arg counts vendor's own
  // src/server/index.ts uses for each factory (verified by reading it) --
  // smart_build/lint/processes/test/typecheck take the full
  // (cache, tokenCounter, metrics) triple; smart_docker/install/logs/network/
  // system_metrics take only `cache` (their factories don't accept a
  // tokenCounter/metrics at all).
  const smartBuild = getSmartBuildTool(cache, tokenCounter, metrics);
  const smartDocker = getSmartDocker(cache);
  const smartInstall = getSmartInstall(cache);
  const smartLint = getSmartLintTool(cache, tokenCounter, metrics);
  const smartLogs = getSmartLogs(cache);
  const smartNetwork = getSmartNetwork(cache);
  const smartProcesses = getSmartProcessesTool(cache, tokenCounter, metrics);
  const smartSystemMetrics = getSmartSystemMetrics(cache);
  const smartTest = getSmartTestTool(cache, tokenCounter, metrics);
  const smartTypeCheck = getSmartTypeCheckTool(cache, tokenCounter, metrics);

  // code-analysis: 8 of 9 real tools wired (see
  // src/optimizer/tools/code-analysis/index.ts's header -- smart_typescript
  // is the one tool left deferred, its entire output being type-check
  // diagnostics from a real type checker Babel cannot substitute for).
  // Each gets ONE shared instance, matching this function's own
  // established convention -- NOT vendor's real dispatch, which for these
  // mostly calls a standalone `runSmartXxx(args)` CLI helper that builds
  // its own throwaway cache/tokenCounter/metrics per call instead.
  // getSmartComplexityTool takes no projectRoot param (unlike refactor/
  // imports/exports, which do) -- verified by reading its factory
  // signature, not assumed from the sibling tools' shape.
  const smartAstGrep = getSmartAstGrepTool(cache, tokenCounter, metrics);
  const smartSecurity = getSmartSecurityTool(cache, tokenCounter, metrics);
  const smartDependencies = getSmartDependenciesTool(cache, tokenCounter, metrics);
  const smartComplexity = getSmartComplexityTool(cache, tokenCounter, metrics);
  const smartRefactor = getSmartRefactorTool(cache, tokenCounter, metrics);
  const smartImports = getSmartImportsTool(cache, tokenCounter, metrics);
  const smartExports = getSmartExportsTool(cache, tokenCounter, metrics);
  const smartSymbols = getSmartSymbolsTool(cache, tokenCounter, metrics);

  // advanced-caching: 8 of 10 instantiated with vendor's own real factory
  // signature -- `getCacheInvalidationTool`/`getCacheReplicationTool` both
  // accept an optional 4th `nodeId?: string` param, but vendor's own
  // dispatch construction calls them with only 3 args (verified directly in
  // vendor's src/server/index.ts), so no nodeId is passed here either. The
  // other 2 (cache_benchmark, cache_compression) are constructed directly
  // via `new` rather than through a vendor-provided factory/free-function
  // singleton -- see src/optimizer/tools/advanced-caching/index.ts's header
  // for exactly which two real defects that avoids (a stale
  // uncoordinated second CacheEngine for compression; a double-JSON-encoded
  // string result for benchmark).
  const cacheAnalytics = getCacheAnalyticsTool(cache, tokenCounter, metrics);
  const cacheBenchmark = new CacheBenchmark(cache, tokenCounter, metrics);
  const cacheCompression = new CacheCompressionTool(cache, tokenCounter, metrics);
  const cacheInvalidation = getCacheInvalidationTool(cache, tokenCounter, metrics);
  const cacheOptimizer = getCacheOptimizerTool(cache, tokenCounter, metrics);
  const cachePartition = getCachePartitionTool(cache, tokenCounter, metrics);
  const cacheReplication = getCacheReplicationTool(cache, tokenCounter, metrics);
  const cacheWarmup = getCacheWarmupTool(cache, tokenCounter, metrics);
  const predictiveCache = getPredictiveCacheTool(cache, tokenCounter, metrics);
  const smartCache = getSmartCacheTool(cache, tokenCounter, metrics);

  // analytics: one shared AnalyticsManager (opens its own SQLite handle at
  // ~/.optiflow/optimizer/analytics.db, separate from `cache`'s -- see
  // OptimizerRuntime.close's own comment), matching every other category's
  // "one shared instance" convention. Each of the 5 factories takes ONLY
  // this manager (verified directly against vendor's real dispatch
  // construction, src/server/index.ts lines 492-496 -- no cache/tokenCounter/
  // metrics arg, unlike every other category here).
  const analyticsManager = new AnalyticsManager();
  const getHookAnalytics = getHookAnalyticsTool(analyticsManager);
  const getActionAnalytics = getActionAnalyticsTool(analyticsManager);
  const getMcpServerAnalytics = getMcpServerAnalyticsTool(analyticsManager);
  const exportAnalytics = getExportAnalyticsTool(analyticsManager);
  const getOptimizationReport = getOptimizationReportTool(analyticsManager);

  // dashboard-monitoring: all 9 wired tools take the same
  // (cache, tokenCounter, metrics) triple every other shared-instance
  // category here uses -- verified per-factory against vendor's real
  // dispatch construction (src/server/index.ts lines 457-467) for the 7
  // vendor dispatches; performance-tracker/smart-dashboard's own factories
  // (never dispatched upstream) take the identical 3-arg shape by their own
  // declared signature. report-generator has no factory to instantiate --
  // see tools/dashboard-monitoring/index.ts's header for why it stays
  // deferred.
  const alertManager = getAlertManager(cache, tokenCounter, metrics);
  const customWidget = getCustomWidget(cache, tokenCounter, metrics);
  const dataVisualizer = getDataVisualizer(cache, tokenCounter, metrics);
  const healthMonitor = getHealthMonitor(cache, tokenCounter, metrics);
  const logDashboard = getLogDashboard(cache, tokenCounter, metrics);
  const metricCollector = getMetricCollector(cache, tokenCounter, metrics);
  const monitoringIntegration = getMonitoringIntegration(cache, tokenCounter, metrics);
  const performanceTracker = createPerformanceTracker(cache, tokenCounter, metrics);
  const smartDashboard = createSmartDashboard(cache, tokenCounter, metrics);

  const rawRegistry: Record<string, ToolHandler> = {
    // Matches vendor `case 'smart_read'`: destructures `path` out of args,
    // forwards the rest as options.
    smart_read: async (args) => {
      const { path, ...options } = args as { path: string };
      return ok(await smartRead.read(path, options));
    },
    // Matches vendor `case 'smart_write'`.
    smart_write: async (args) => {
      const { path, content, ...options } = args as {
        path: string;
        content: string;
      };
      return ok(await smartWrite.write(path, content, options));
    },
    // Matches vendor `case 'smart_edit'`.
    smart_edit: async (args) => {
      const { path, operations, ...options } = args as {
        path: string;
        operations: unknown;
      };
      return ok(
        await smartEdit.edit(
          path,
          operations as Parameters<typeof smartEdit.edit>[1],
          options
        )
      );
    },
    // Matches vendor `case 'smart_glob'`.
    smart_glob: async (args) => {
      const { pattern, ...options } = args as { pattern: string };
      return ok(await smartGlob.glob(pattern, options));
    },
    // Matches vendor `case 'smart_grep'`.
    smart_grep: async (args) => {
      const { pattern, ...options } = args as { pattern: string };
      return ok(await smartGrep.grep(pattern, options));
    },
    // Matches vendor `case 'smart_status'`: the whole args object IS the
    // options object (no positional field is pulled out first).
    smart_status: async (args) => ok(await smartStatus.status(args)),
    smart_diff: async (args) => ok(await smartDiff.diff(args)),
    smart_log: async (args) => ok(await smartLog.log(args)),
    smart_branch: async (args) => ok(await smartBranch.branch(args)),
    smart_merge: async (args) => ok(await smartMerge.merge(args)),
    // Matches vendor `case 'smart_env'`: whole-args-object, no destructuring.
    smart_env: async (args) => ok(await smartEnv.run(args as any)),
    // Matches vendor `case 'smart_package_json'`: whole-args-object.
    smart_package_json: async (args) => ok(await smartPackageJson.run(args as any)),
    // Matches vendor `case 'smart_config_read'`: destructures the schema's
    // `path` field first (NOT `filePath` — vendor's own comment documents a
    // real bug caused by getting this wrong), forwards the rest as options.
    smart_config_read: async (args) => {
      const { path, ...options } = args as { path: string };
      return ok(await smartConfigRead.read(path, options));
    },
    // Matches vendor `case 'smart_tsconfig'`: whole-args-object.
    smart_tsconfig: async (args) => ok(await smartTsConfig.run(args as any)),
    // Not dispatched anywhere in vendor's own server (genuinely unwired
    // upstream) — schema's positional field is `filePath`, not `path`.
    smart_workflow: async (args) => {
      const { filePath, ...options } = args as { filePath: string };
      return ok(await smartWorkflow.analyze(filePath, options));
    },
    // Matches vendor `case 'smart_pretty'`: whole-args-object.
    smart_pretty: async (args) => ok(await smartPretty.run(args as any)),

    // system-operations: all four are whole-args-object, matching the
    // getX(cache, tokenCounter, metrics).run(options) pattern used throughout.
    smart_process: async (args) => ok(await smartProcess.run(args as any)),
    smart_service: async (args) => ok(await smartService.run(args as any)),
    smart_cron: async (args) => ok(await smartCron.run(args as any)),
    smart_user: async (args) => ok(await smartUser.run(args as any)),

    // intelligence: knowledge_graph and sentiment_analysis are not actually
    // dispatched anywhere in vendor's own server (genuinely unwired
    // upstream) but are real, working, compiling tools — wired here as an
    // improvement over vendor's own coverage, whole-args-object per their
    // schemas.
    knowledge_graph: async (args) => ok(await knowledgeGraph.run(args as any)),
    sentiment_analysis: async (args) => ok(await sentimentAnalysis.run(args as any)),
    // wiki_read/wiki_write are plain functions (no class/factory), not
    // dispatched via a shared instance. Their real behavior depends on
    // hooks-core/wiki.mjs, not yet ported into src/optimizer/ (later phase) —
    // they degrade gracefully to a real, typed "nothing found" result rather
    // than throwing, per their own source.
    wiki_read: async (args) => ok(await wikiRead(args as any)),
    wiki_write: async (args) => ok(await wikiWrite(args as any)),

    // api-database: every one of these matches vendor's real dispatch
    // exactly -- `case 'smart_xxx': { const options = args as any; const
    // result = await smartXxx.run(options); ... }` -- whole-args-object,
    // no positional field pulled out first, for all 10 tools in this
    // category (verified by reading vendor's src/server/index.ts directly).
    // See src/optimizer/tools/api-database/index.ts for which of these do
    // genuine analysis (7 tools), which return real-or-honestly-erroring
    // results (smart_schema: real SQLite introspection, explicit "no
    // driver" errors for postgres/mysql rather than fabrication), and
    // which still return placeholder/mocked data (smart_database,
    // smart_migration) for pieces that would otherwise need a live DB/HTTP
    // connection this MCP tool doesn't have.
    smart_api_fetch: async (args) => ok(await smartApiFetch.run(args as any)),
    smart_cache_api: async (args) => ok(await smartCacheApi.run(args as any)),
    smart_database: async (args) => ok(await smartDatabase.run(args as any)),
    smart_graphql: async (args) => ok(await smartGraphQL.run(args as any)),
    smart_migration: async (args) => ok(await smartMigration.run(args as any)),
    smart_orm: async (args) => ok(await smartOrm.run(args as any)),
    smart_rest: async (args) => ok(await smartRest.run(args as any)),
    smart_schema: async (args) => ok(await smartSchema.run(args as any)),
    smart_sql: async (args) => ok(await smartSql.run(args as any)),
    smart_websocket: async (args) => ok(await smartWebSocket.run(args as any)),

    // build-systems: every one of these matches vendor's real dispatch
    // exactly -- `case 'smart_xxx': { const options = args as any; const
    // result = await smartXxx.run(options); ... }` -- whole-args-object,
    // no positional field pulled out first, for all 10 tools in this
    // category (verified by reading vendor's src/server/index.ts directly).
    // See src/optimizer/tools/build-systems/index.ts for: which of the 10
    // vendor's own (incomplete) category index.ts re-exports vs. which it
    // omitted despite dispatching them for real; the Windows
    // CVE-2024-27980 spawn workaround five of these already carried before
    // this checkpoint (smart_build/lint/typecheck/install/test) vs. the
    // other five spawning real OS executables that never needed it; and a
    // known projectRoot-staleness divergence across smart_install/
    // smart_docker/smart_logs (ported as-is, not silently patched).
    smart_build: async (args) => ok(await smartBuild.run(args as any)),
    smart_docker: async (args) => ok(await smartDocker.run(args as any)),
    smart_install: async (args) => ok(await smartInstall.run(args as any)),
    smart_lint: async (args) => ok(await smartLint.run(args as any)),
    smart_logs: async (args) => ok(await smartLogs.run(args as any)),
    smart_network: async (args) => ok(await smartNetwork.run(args as any)),
    smart_processes: async (args) => ok(await smartProcesses.run(args as any)),
    smart_system_metrics: async (args) => ok(await smartSystemMetrics.run(args as any)),
    smart_test: async (args) => ok(await smartTest.run(args as any)),
    smart_typecheck: async (args) => ok(await smartTypeCheck.run(args as any)),

    // code-analysis: whole-args-object `.run(args)` for smart_security/
    // smart_dependencies/smart_complexity/smart_refactor/smart_imports/
    // smart_exports/smart_symbols (`.run()` on SmartDependenciesTool is a
    // plain alias of `.analyze()`), matching every other already-wired
    // category's shared-instance dispatch style AND matching vendor's own
    // real dispatch for these -- verified directly in
    // vendor/token-optimizer-mcp/src/server/index.ts: every one of
    // smart_complexity/smart_exports/smart_imports/smart_refactor/
    // smart_symbols passes `args as any` straight through there too (only
    // the CLI helper vs. shared-instance plumbing differs, not the
    // argument shape). smart_ast_grep is the one positional-arg case,
    // matching file-operations' smart_grep destructuring style.
    // smart_typescript is the one code-analysis tool still deferred -- see
    // src/optimizer/tools/code-analysis/index.ts's header.
    smart_ast_grep: async (args) => {
      const { pattern, ...options } = args as { pattern: string };
      return ok(await smartAstGrep.grep(pattern, options as any));
    },
    smart_security: async (args) => ok(await smartSecurity.run(args as any)),
    smart_dependencies: async (args) => ok(await smartDependencies.run(args as any)),
    smart_complexity: async (args) => ok(await smartComplexity.run(args as any)),
    smart_refactor: async (args) => ok(await smartRefactor.run(args as any)),
    smart_imports: async (args) => ok(await smartImports.run(args as any)),
    smart_exports: async (args) => ok(await smartExports.run(args as any)),
    smart_symbols: async (args) => ok(await smartSymbols.run(args as any)),

    // advanced-caching: every one of these matches vendor's real dispatch
    // shape exactly -- whole-args-object `.run(options)`, no positional
    // field pulled out first (verified directly in vendor's
    // src/server/index.ts, lines 1834-1860 and 2081-2196). cache_benchmark
    // and cache_compression dispatch via the directly-constructed shared
    // instances above rather than vendor's own free-function wrappers --
    // see src/optimizer/tools/advanced-caching/index.ts's header for why
    // (both wrappers have real defects: a stale second CacheEngine for
    // compression, a double-JSON-encoded string result for benchmark).
    predictive_cache: async (args) => ok(await predictiveCache.run(args as any)),
    cache_warmup: async (args) => ok(await cacheWarmup.run(args as any)),
    cache_analytics: async (args) => ok(await cacheAnalytics.run(args as any)),
    cache_benchmark: async (args) => ok(await cacheBenchmark.run(args as any)),
    cache_compression: async (args) => ok(await cacheCompression.run(args as any)),
    cache_invalidation: async (args) => ok(await cacheInvalidation.run(args as any)),
    cache_optimizer: async (args) => ok(await cacheOptimizer.run(args as any)),
    cache_partition: async (args) => ok(await cachePartition.run(args as any)),
    cache_replication: async (args) => ok(await cacheReplication.run(args as any)),
    smart_cache: async (args) => ok(await smartCache.run(args as any)),

    // analytics: all 5 dispatch via `okPreformatted()`, NOT `ok()` -- see
    // that helper's own comment and src/optimizer/tools/analytics/index.ts's
    // header for why (these factories already return a JSON string, unlike
    // every other category's real object result). Matches vendor's real
    // dispatch exactly: `content: [{ type: 'text', text: result }]` with no
    // re-stringify (verified directly, src/server/index.ts lines 2851-2884).
    get_hook_analytics: async (args) => okPreformatted(await getHookAnalytics(args as any)),
    get_action_analytics: async (args) => okPreformatted(await getActionAnalytics(args as any)),
    get_mcp_server_analytics: async (args) => okPreformatted(await getMcpServerAnalytics(args as any)),
    export_analytics: async (args) => okPreformatted(await exportAnalytics(args as any)),
    get_optimization_report: async (args) => okPreformatted(await getOptimizationReport(args as any)),

    // dashboard-monitoring: every one of these matches vendor's real
    // dispatch shape exactly for the 7 vendor dispatches -- whole-args-object
    // `.run(options)`, `JSON.stringify(result, null, 2)` (i.e. the generic
    // `ok()` helper), no positional field pulled out first (verified
    // directly in vendor's src/server/index.ts, lines 2682-2771).
    // performance-tracker/smart-dashboard have no vendor dispatch case to
    // verify against (see this category's index.ts header), but their own
    // `.run(options)` methods take the identical whole-args-object shape, so
    // `ok()` is used for them too, matching every other category's
    // convention rather than inventing a different one. The registry keys
    // below are byte-identical to each TOOL_DEFINITION's own `name` field,
    // INCLUDING performance-tracker's/smart-dashboard's hyphenated
    // 'performance-tracker'/'smart-dashboard' (not renamed to fit the
    // underscore convention every other tool here happens to use) -- see
    // this category's index.ts header for why.
    alert_manager: async (args) => ok(await alertManager.run(args as any)),
    custom_widget: async (args) => ok(await customWidget.run(args as any)),
    data_visualizer: async (args) => ok(await dataVisualizer.run(args as any)),
    health_monitor: async (args) => ok(await healthMonitor.run(args as any)),
    log_dashboard: async (args) => ok(await logDashboard.run(args as any)),
    metric_collector: async (args) => ok(await metricCollector.run(args as any)),
    monitoring_integration: async (args) => ok(await monitoringIntegration.run(args as any)),
    "performance-tracker": async (args) => ok(await performanceTracker.run(args as any)),
    "smart-dashboard": async (args) => ok(await smartDashboard.run(args as any)),

    // Optiflow's own tool (everything above is vendored). Uses
    // `okPreformatted`, not `ok()`: the stored content is arbitrary text
    // that was already serialized once when it was compressed, so passing
    // it through `JSON.stringify` would hand the model an escaped string
    // literal instead of the content it asked for -- the same
    // double-encoding defect this file's `okPreformatted` header describes.
    ccr_retrieve: async (args) => okPreformatted(runCcrRetrieveTool(args).text),
  };

  // ARCHITECTURAL DECISION (Part 1 of this checkpoint -- see
  // src/optimizer/analytics/record-tool-analytics.ts's own header for the
  // full reasoning): vendor's real src/server/index.ts calls
  // `recordToolAnalytics()` on the result of EVERY tool dispatch --
  // "THE ONE PLACE EVERY TOOL RESULT PASSES THROUGH" per that file's own
  // comment, not just the 5 analytics-category tools. That breadth is real
  // vendor behavior, not incidental, so it's replicated here: every entry in
  // `rawRegistry` (all 67 tools, including the 5 analytics ones themselves,
  // exactly matching vendor's own switch-statement shape where the analytics
  // cases fall inside the same `handleToolCall()` that gets recorded
  // afterwards) is wrapped below with a call to `recordToolAnalytics()`
  // AFTER the real handler runs, so both `createOptimizerServer()`'s stdio
  // dispatch AND direct `registry[name](args)` calls (e.g. from tests) are
  // recorded identically -- one wrapping point instead of duplicating it in
  // both `createOptimizerServer()`'s CallTool handler and here.
  //
  // No `baselineResult` / `attribution` is threaded through (optiflow has no
  // `discloseResult()`/`mcpEvidence` subsystem yet -- out of this
  // checkpoint's scope): this means `savingsMeasured` is always `false` and
  // `tokensSaved` is always `0` for every recorded entry (an HONEST
  // degraded mode, not a fabricated one -- no savings claim is invented).
  // What's still real: `totalOperations` and `totalOptimizedTokens` (the
  // actual returned-payload token count) per tool/hook-phase/server, so
  // `get_hook_analytics`/`get_action_analytics`/`get_mcp_server_analytics`
  // have real non-zero usage data from the very first tool call, rather than
  // an always-empty store. Recording failures never break the underlying
  // tool call (`recordToolAnalytics()` swallows its own errors internally,
  // per that function's own "must never break a tool call" contract) and
  // are not awaited-and-ignored here either -- they ARE awaited, so a
  // flush failure surfaces as a slow response rather than a silently lost
  // write, but never as a thrown error back to the caller.
  const registry: Record<string, ToolHandler> = {};
  for (const [name, handler] of Object.entries(rawRegistry)) {
    registry[name] = async (args) => {
      const result = await handler(args);
      await recordToolAnalytics(analyticsManager, name, result as any, {});
      return result;
    };
  }

  return {
    registry,
    cache,
    close: async () => {
      // `AnalyticsManager`/`SqliteAnalyticsStorage` open their OWN SQLite
      // handle (~/.optiflow/optimizer/analytics.db), separate from `cache`'s
      // -- both must be closed, matching this file's own established
      // "every SQLite handle this runtime opened gets closed here" contract
      // (see OptimizerRuntime.close's own comment).
      await analyticsManager.close();
      cache.close();
    },
  };
}

export function createOptimizerServer(): Server {
  const { registry } = createOptimizerRuntime();

  const server = new Server(
    {
      // Vendor hardcoded 'token-optimizer-mcp' here; this is optiflow's own
      // merged server identity.
      name: "optiflow-optimizer",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = registry[name];
    if (!handler) {
      return errorResult(new Error(`Unknown tool: ${name}`)) as CallToolResult;
    }
    try {
      return (await handler(
        (args ?? {}) as Record<string, unknown>
      )) as CallToolResult;
    } catch (error) {
      return errorResult(error) as CallToolResult;
    }
  });

  return server;
}

async function main(): Promise<void> {
  const server = createOptimizerServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Guarded process entry point, matching the pattern already used by
// src/chop/pretooluse.ts and src/handoff/precompact-hook.ts.
const entryArg = process.argv[1];
const isDirectRun =
  typeof entryArg === "string" &&
  import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error("optiflow-optimizer server failed to start:", error);
    process.exit(1);
  });
}
