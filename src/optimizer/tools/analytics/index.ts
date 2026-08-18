/**
 * Analytics tools for granular token tracking
 *
 * Ported from vendor/token-optimizer-mcp/src/tools/analytics/ (MIT-licensed
 * -- see THIRD_PARTY_LICENSES.md). This category was explicitly deferred by
 * an earlier checkpoint's initial exploration because its whole dependency
 * -- src/optimizer/analytics/ -- didn't exist yet; that infra is now ported
 * (see src/optimizer/analytics/*.ts's own headers) and this checkpoint wires
 * all 5 real tools (get_hook_analytics, get_action_analytics,
 * get_mcp_server_analytics, export_analytics, get_optimization_report). The
 * 6th file here (this index.ts) is a real barrel, not a 6th tool -- vendor's
 * own module surface matches exactly what's re-exported below, nothing
 * omitted or added.
 *
 * DISPATCH SHAPE (verified directly against vendor's real
 * src/server/index.ts, lines 2851-2884): each factory takes a single shared
 * `AnalyticsManager` argument and returns a plain async function (NOT a
 * class+method, unlike every other category ported so far) that returns a
 * pre-formatted JSON STRING, not an object -- `getHookAnalyticsTool(mgr)`
 * returns `async (args) => string`, and vendor's own dispatch puts that
 * string directly into `content: [{ type: 'text', text: result }]`, with NO
 * re-`JSON.stringify` on top. This is the same double-encoding defect class
 * checkpoints 6/7 found in `runSmartSymbols`/`runCacheBenchmark` and did NOT
 * replicate there -- here there's no alternative "real object" API to
 * dispatch through instead (these 5 factories are the tools' only real
 * shape, no class alternative exists), so `src/optimizer/server.ts` uses a
 * dedicated `okPreformatted()` wrapper for this category's 5 registry
 * entries instead of the generic `ok()` helper every other category uses,
 * matching vendor's real behavior exactly rather than double-encoding.
 *
 * `export_analytics`'s schema has `required: ['format']` (verified directly
 * in export-analytics.ts's own `EXPORT_ANALYTICS_TOOL_DEFINITION`) -- an
 * omitted `format` is a real validation failure, not an optional field with
 * a default.
 */

export {
  getHookAnalyticsTool,
  GET_HOOK_ANALYTICS_TOOL_DEFINITION,
} from './get-hook-analytics.js';

export {
  getActionAnalyticsTool,
  GET_ACTION_ANALYTICS_TOOL_DEFINITION,
} from './get-action-analytics.js';

export {
  getMcpServerAnalyticsTool,
  GET_MCP_SERVER_ANALYTICS_TOOL_DEFINITION,
} from './get-mcp-server-analytics.js';

export {
  getExportAnalyticsTool,
  EXPORT_ANALYTICS_TOOL_DEFINITION,
} from './export-analytics.js';

export {
  getOptimizationReportTool,
  GET_OPTIMIZATION_REPORT_TOOL_DEFINITION,
} from './get-optimization-report.js';
