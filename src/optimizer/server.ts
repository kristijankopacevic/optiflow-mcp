#!/usr/bin/env node
// optiflow's own MCP server for the merged optimizer tools (ported from
// vendor/token-optimizer-mcp, MIT-licensed — see THIRD_PARTY_LICENSES.md).
//
// SCOPE (see the merge plan's Phase 5 gate): this is a real, working
// optiflow-owned MCP server wired to the file-operations tool category
// (smart_read/write/edit/glob/grep/status/diff/log/branch/merge) as the
// vertical slice for this phase. It replaces token-optimizer-mcp's own
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
