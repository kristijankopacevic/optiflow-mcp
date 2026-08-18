/**
 * Dashboard & Monitoring Tools - Alerting, Widgets, Visualization, Health
 * Checks, Log Dashboards, Metric Collection, External-Platform Integration,
 * Performance Tracking, and a Unified Health/Dependency Dashboard
 *
 * *** 9 OF 10 REAL TOOLS ARE WIRED/EXPORTED HERE *** (alert_manager,
 * custom_widget, data_visualizer, health_monitor, log_dashboard,
 * metric_collector, monitoring_integration, performance-tracker,
 * smart-dashboard). Only report-generator.ts stays deferred -- see its own
 * "DEFERRED" header comment for why (no `name`/`inputSchema`/factory
 * function anywhere in the file -- there's no schema to build an MCP Tool
 * definition from without inventing one, unlike smart_typescript's
 * precedent, which was a complete, compiling, real tool that vendor simply
 * never dispatched).
 *
 * DUAL-SIGNAL VERIFICATION (per the merge plan's own checkpoint-4 lesson):
 * vendor's own category `index.ts` under-reports this category too -- it
 * says only "SmartDashboard - Implementation pending" / "MetricCollector -
 * Implementation pending" and exports nothing at all. Vendor's REAL
 * `src/server/index.ts` tells a different story for 7 of these 10, verified
 * by reading it directly: `alert_manager`/`metric_collector`/
 * `monitoring_integration`/`custom_widget`/`data_visualizer`/
 * `health_monitor`/`log_dashboard` are all imported and each has a real
 * `case 'xxx':` dispatch (lines 2682-2771), every one a whole-args-object
 * `.run(options)` call through a `getXxx(cache, tokenCounter, metrics)`
 * shared-instance factory -- matching this merge's own established
 * shared-instance convention exactly (verified per-factory, not assumed --
 * `getMonitoringIntegration` is the one call vendor itself wraps across
 * multiple lines, but it still takes the same 3 args as the other 6).
 *
 * THE OTHER 3 (`performance-tracker.ts`, `report-generator.ts`,
 * `smart-dashboard.ts`) are NOT dispatched anywhere in vendor's real
 * server -- confirmed by grepping vendor's whole `src/` tree for
 * `PerformanceTracker`/`SmartDashboard`/`ReportGenerator`, not just
 * `server/index.ts`. That alone is NOT this merge's deferral criterion,
 * though (see `smart_workflow`/`knowledge_graph`/`sentiment_analysis` in
 * `src/optimizer/server.ts`, all wired despite being genuinely unwired
 * upstream too) -- the real criterion is whether a complete, compiling MCP
 * tool definition (a `name` + `inputSchema`) exists to wire:
 *   - `performance-tracker.ts` has `createPerformanceTracker()` +
 *     `performanceTrackerTool` with a full `name`/`inputSchema` -- wired.
 *   - `smart-dashboard.ts` has `createSmartDashboard()` + `smartDashboardTool`
 *     with the same shape -- wired.
 *   - `report-generator.ts` has ONLY the `ReportGenerator` class (verified:
 *     no `export function`/`export const` of any kind below its class body)
 *     -- genuinely nothing to wire without fabricating a schema vendor
 *     itself never wrote. Deferred, matching the `smart_typescript`
 *     precedent's spirit (copied in, excluded from `tsconfig.json`'s compile
 *     graph, not exported here) even though the underlying reason differs
 *     (a missing schema, not a missing runtime dependency).
 *
 * A REAL NAMING-CONVENTION MISMATCH, PORTED AS-IS: `performanceTrackerTool`
 * and `smartDashboardTool`'s own `name` fields are `'performance-tracker'`
 * and `'smart-dashboard'` -- HYPHENATED, unlike every other tool name in
 * this entire merged server (all underscore-separated: `alert_manager`,
 * `health_monitor`, etc., including this category's other 7). Since neither
 * tool has a vendor dispatch `case` to confirm an intended name against, the
 * tool definition's own `name` field is the only authoritative source --
 * `src/optimizer/server.ts`'s registry key for each is byte-identical to
 * this field, not silently renamed to fit the underscore convention (that
 * would break `ListTools`/`CallTool` name agreement for no real benefit).
 *
 * `smart-dashboard.ts` IS A NEAR-VERBATIM CLONE of `health-monitor.ts`
 * (verified with a direct diff of both files' class bodies): same 8
 * operations (`check`/`register-check`/`update-check`/`delete-check`/
 * `get-status`/`get-history`/`configure-dependencies`/`get-impact`), same
 * `HealthCheck`/`ServiceStatus`/`HealthCheckEvent`/`DependencyGraph`/
 * `ImpactAnalysis` type shapes, same on-demand `executeHttpCheck` abort-timer
 * pattern -- it's vendor's own "unified dashboard" tool built by extending
 * health-monitor's health-check subsystem with widget/dependency-graph
 * framing on top, not a coincidental name clash. That gives this category
 * ITS OWN 5-type collision (on top of the pre-existing `AxisConfig`/
 * `SeriesConfig` collision between `custom-widget.ts` and
 * `data-visualizer.ts`), resolved below with the same "alias the
 * non-canonical side" convention checkpoint 3 established and checkpoint 7
 * used six times: `health-monitor.ts` keeps the unaliased names (the
 * original of the pair); `smart-dashboard.ts`'s re-exported under a
 * `Dashboard`-prefixed alias. `data-visualizer.ts` (the more central
 * "visualization" tool, and the one dispatched in vendor's real server,
 * unlike `custom-widget.ts`'s widget-authoring use of the same two shapes)
 * keeps `AxisConfig`/`SeriesConfig` unaliased; `custom-widget.ts`'s aliased
 * to `WidgetAxisConfig`/`WidgetSeriesConfig`.
 *
 * NO PROJECTROOT-STALENESS BUG CLASS HERE: verified by grep across all 10
 * files -- none references a `projectRoot` option at all (this category
 * operates on in-memory/cached alert/widget/chart/check/metric/connection
 * state via the shared `CacheEngine`, not a project's file tree).
 *
 * NO ARCHITECTURAL-MISMATCH DEFERRALS: `monitoring-integration.ts`'s
 * `connect`/`sync-metrics`/`push-data` operations read like they'd need a
 * live external platform (Datadog/Grafana/etc. vocabulary appears in its
 * comments), but verified by reading its imports and `connect`/`healthCheck`
 * methods directly: no `http`/`https`/`net`/`fetch`/platform-SDK import
 * anywhere -- `testConnection`/`healthCheck` are both a bare `await new
 * Promise((resolve) => setTimeout(resolve, 100))` / `50)` (a simulated
 * latency delay, not a real network call), and `fetchMetricsFromPlatform`
 * generates synthetic data in-process. Pure simulation over the shared
 * `CacheEngine`, matching optiflow's single-process architecture as-is, same
 * finding as advanced-caching's replication/partition tools.
 * `health-monitor.ts`/`smart-dashboard.ts`'s `http` check type DOES call a
 * real `fetch()` against a caller-supplied URL for the `check`/`'http'`
 * operation specifically -- a real, intentional network capability of that
 * one operation (checking if some OTHER service is up), not an
 * architectural mismatch with this MCP server's own local-process design.
 *
 * NO NEW NPM DEPENDENCIES: every cross-file import
 * (`../../core/cache-engine.js`, `../../core/token-counter.js`,
 * `../../core/metrics.js`, `../../utils/cache-helper.js`'s
 * `readCompressedJson`, `../shared/compression-utils.js`'s `compress`,
 * `../shared/hash-utils.js`'s `generateCacheKey`) already existed from
 * earlier checkpoints. `custom-widget.ts`'s `renderToReact()` method emits
 * `import React from 'react';` as TEXT inside a generated-source-code
 * template string (its own React-component-as-a-string output) -- NOT a
 * real `import` statement in this file, verified directly; no `react`
 * dependency was added or is needed.
 *
 * TIMER HYGIENE, MATCHING CHECKPOINT 7'S PRECEDENT: grepped for
 * `setInterval`/`setTimeout` across all 10 files -- NO constructor-started
 * background timer exists anywhere in this category (unlike checkpoint 7's
 * real finding in cache-replication/cache-invalidation), so there is no
 * "merely constructing this tool hangs the process forever" defect class
 * here. Three on-demand, lower-severity timers were still `.unref()`'d for
 * the same hygiene reason checkpoint 7 unref'd cache-invalidation's
 * lazyProcessTimer / smart-cache's writeBackTimer: `alert-manager.ts`'s
 * silence-auto-cleanup `setTimeout` (fires only after an explicit `silence`
 * call), and `health-monitor.ts`'s / `smart-dashboard.ts`'s identical
 * `executeHttpCheck` abort-controller timeout (already self-clearing on
 * both its success and catch paths, but unref'd in case `fetch` itself ever
 * hangs without honoring the abort signal). `monitoring-integration.ts`'s
 * two `await new Promise((resolve) => setTimeout(resolve, 100/50))` delays
 * are awaited inline and resolve in well under a second on their own --
 * left as-is, not a real hang risk.
 *
 * NO NEW paths.ts HELPER NEEDED: verified by grepping every import across
 * all 10 files -- none resolves an `os.homedir()`/hardcoded
 * `~/.token-optimizer*`/`~/.hypercontext*` path; every persistence need here
 * goes through the shared `CacheEngine` (in-process `Map`s backed by the
 * same SQLite cache, not a separate on-disk file), unlike advanced-caching's
 * `cache-benchmark.ts` report-file need.
 */

export {
  AlertManager,
  getAlertManager,
  ALERT_MANAGER_TOOL_DEFINITION,
  type AlertManagerOptions,
  type AlertManagerResult,
  type AlertCondition,
  type DataSource,
  type Alert,
  type AlertEvent,
  type NotificationChannel,
  type SilenceRule,
} from './alert-manager.js';

export {
  CustomWidget,
  getCustomWidget,
  CUSTOM_WIDGET_TOOL_DEFINITION,
  type CustomWidgetOptions,
  type CustomWidgetResult,
  type WidgetConfig,
  // Aliased: differs from data-visualizer.ts's own `AxisConfig`/
  // `SeriesConfig` (already exported below under their own names -- see
  // this file's header for why data-visualizer.ts keeps the unaliased pair).
  type AxisConfig as WidgetAxisConfig,
  type SeriesConfig as WidgetSeriesConfig,
  type ThresholdConfig,
  type ColumnConfig,
  type PaginationConfig,
  type RangeConfig,
  type DataSourceConfig,
  type Widget,
  type WidgetTemplate,
  type ValidationResult,
} from './custom-widget.js';

export {
  DataVisualizer,
  getDataVisualizer,
  DATA_VISUALIZER_TOOL_DEFINITION,
  type DataVisualizerOptions,
  type DataVisualizerResult,
  type AxisConfig,
  type SeriesConfig,
  type LegendConfig,
  type TooltipConfig,
  type Chart,
} from './data-visualizer.js';

export {
  HealthMonitor,
  getHealthMonitor,
  HEALTH_MONITOR_TOOL_DEFINITION,
  type HealthMonitorOptions,
  type HealthMonitorResult,
  type HealthCheck,
  type ServiceStatus,
  type HealthCheckEvent,
  type DependencyGraph,
  type ImpactAnalysis,
} from './health-monitor.js';

export {
  LogDashboard,
  getLogDashboard,
  LOG_DASHBOARD_TOOL_DEFINITION,
  type LogDashboardOptions,
  type LogDashboardResult,
  type LogLevel,
  type LogSource,
  type LogFilter,
  type LogEntry,
  type LogDashboardData,
  type LogWidget,
  type DashboardLayout,
  type LogAggregation,
  type LogAnomaly,
} from './log-dashboard.js';

export {
  MetricCollector,
  getMetricCollector,
  METRIC_COLLECTOR_TOOL_DEFINITION,
  type MetricCollectorOptions,
  type MetricCollectorResult,
  type MetricSource,
  type MetricDataPoint,
  type CompressedMetricSeries,
  type MetricAggregation,
  type MetricCollectorStats,
} from './metric-collector.js';

export {
  MonitoringIntegration,
  getMonitoringIntegration,
  MONITORING_INTEGRATION_TOOL_DEFINITION,
  type MonitoringIntegrationOptions,
  type MonitoringIntegrationResult,
  type PlatformConnection,
  type SyncedMetric,
  type SyncedAlert,
  type IntegrationHealth,
} from './monitoring-integration.js';

export {
  PerformanceTracker,
  createPerformanceTracker,
  performanceTrackerTool,
  type PerformanceTrackerOptions,
  type PerformanceTrackerResult,
  type PerformanceMetric,
  type PerformanceTrend,
  type PerformanceForecast,
  type PerformanceComparison,
  type PerformanceRegression,
  type PerformanceBaseline,
  type PerformanceReport,
} from './performance-tracker.js';

export {
  SmartDashboard,
  createSmartDashboard,
  smartDashboardTool,
  type SmartDashboardOptions,
  type SmartDashboardResult,
  // Aliased: differs from health-monitor.ts's own `HealthCheck`/
  // `ServiceStatus`/`HealthCheckEvent`/`DependencyGraph`/`ImpactAnalysis`
  // (already exported above under their own names -- see this file's header
  // for why health-monitor.ts, the original of the pair, keeps them
  // unaliased).
  type HealthCheck as DashboardHealthCheck,
  type ServiceStatus as DashboardServiceStatus,
  type HealthCheckEvent as DashboardHealthCheckEvent,
  type DependencyGraph as DashboardDependencyGraph,
  type ImpactAnalysis as DashboardImpactAnalysis,
} from './smart-dashboard.js';

// report-generator.ts is DELIBERATELY NOT exported here -- see this file's
// header for why (no name/inputSchema/factory anywhere in that file; it's
// also excluded from tsconfig.json's compile graph, matching the
// smart_typescript precedent).
