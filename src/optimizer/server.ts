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
// (only 3 of 9 real tools wired: smart_ast_grep/security/dependencies —
// see src/optimizer/tools/code-analysis/index.ts's header for the full
// explanation, but in short: the other 6
// (smart_typescript/symbols/complexity/refactor/imports/exports) all
// `import * as ts from 'typescript'` for the classic Compiler API
// (createSourceFile, SyntaxKind, node type guards, ...), and this repo's
// typescript@^7.0.2 is the native/Go-rewritten compiler whose package no
// longer ships that API under its public exports at all — a real,
// repo-wide dependency question, not something this checkpoint decided
// unilaterally. Those 6 files are copied to disk with path reconciliation
// (and, for smart_typescript/symbols, a projectRoot-staleness fix) already
// applied, but excluded from tsconfig.json's compile graph and NOT wired
// here until the coordinator resolves that question. Of the 3 that ARE
// wired: smart_security had the same projectRoot-staleness bug class
// checkpoint 4 found in build-systems, fixed live here; smart_dependencies
// also got a real dependency substitution
// (@typescript-eslint/typescript-estree dropped for the same TS-7 peer
// conflict, replaced by routing its parsing entirely through the
// already-added @babel/parser) and a vendor dispatch-shape improvement
// (its own free-function CLI helper's double-JSON-encoding-a-string defect
// is not replicated; dispatched via a shared instance like every other
// category here instead). Still-deferred categories (advanced-caching,
// analytics tools — blocked on the separate src/analytics/ persistence
// merge —, dashboard-monitoring) have no tools copied or wired yet. It
// replaces token-optimizer-mcp's own
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

// code-analysis: only 3 of 9 real tools are wired -- see
// src/optimizer/tools/code-analysis/index.ts's header for why the other 6
// (smart_typescript/symbols/complexity/refactor/imports/exports) are
// deferred (a repo-wide typescript@^7 Compiler-API-removal blocker, not a
// code-analysis-local issue) and excluded from tsconfig.json's compile
// graph rather than wired here.
import { getSmartAstGrepTool, SMART_AST_GREP_TOOL_DEFINITION } from "./tools/code-analysis/smart-ast-grep.js";
import { getSmartSecurityTool, SMART_SECURITY_TOOL_DEFINITION } from "./tools/code-analysis/smart-security.js";
import { getSmartDependenciesTool, SMART_DEPENDENCIES_TOOL_DEFINITION } from "./tools/code-analysis/smart-dependencies.js";

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
  /** Releases the underlying SQLite handle. Callers (tests especially,
   * since Windows won't let a temp dir be removed while its cache.db is
   * still open) must call this when done with the runtime. */
  close: () => void;
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

  // code-analysis: only 3 of 9 real tools wired (see
  // src/optimizer/tools/code-analysis/index.ts's header -- 6 more depend on
  // a typescript@^7 Compiler API this repo's version no longer ships, a
  // repo-wide dependency question deferred to the coordinator, not decided
  // here). Each gets ONE shared instance, matching this function's own
  // established convention -- NOT vendor's real dispatch, which for these
  // 3 mostly calls a standalone `runSmartXxx(args)` CLI helper that builds
  // its own throwaway cache/tokenCounter/metrics per call instead.
  const smartAstGrep = getSmartAstGrepTool(cache, tokenCounter, metrics);
  const smartSecurity = getSmartSecurityTool(cache, tokenCounter, metrics);
  const smartDependencies = getSmartDependenciesTool(cache, tokenCounter, metrics);

  const registry: Record<string, ToolHandler> = {
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
    // smart_dependencies (`.run()` on SmartDependenciesTool is a plain alias
    // of `.analyze()`), matching every other already-wired category's
    // shared-instance dispatch style. smart_ast_grep is the one
    // positional-arg case, matching file-operations' smart_grep
    // destructuring style. The other 6 code-analysis tools are deferred --
    // see src/optimizer/tools/code-analysis/index.ts's header.
    smart_ast_grep: async (args) => {
      const { pattern, ...options } = args as { pattern: string };
      return ok(await smartAstGrep.grep(pattern, options as any));
    },
    smart_security: async (args) => ok(await smartSecurity.run(args as any)),
    smart_dependencies: async (args) => ok(await smartDependencies.run(args as any)),
  };

  return { registry, cache, close: () => cache.close() };
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
