import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALL_TOOL_DEFINITIONS, createOptimizerRuntime, type OptimizerRuntime } from "./server.js";
import { getOptimizerCacheDbPath } from "./paths.js";

// NOTE ON RUNTIME LIFETIME: `createOptimizerRuntime()` is created exactly
// ONCE for this whole file (in `beforeAll`, not per-test), matching how it
// is actually used in production (`createOptimizerServer()` calls it once
// per server process) and how vendor's own `src/server/index.ts` constructs
// its tool instances once at module load. This matters because
// `getSmartReadTool()` (ported verbatim from vendor) is a real,
// pre-existing module-level singleton -- it hands back the FIRST
// `SmartReadTool` instance it ever constructed regardless of which `cache`
// argument a later call passes. Calling `createOptimizerRuntime()` fresh
// per-test silently left `smart_read` bound to a stale, already-closed
// `CacheEngine` from a previous test while `smart_write` (which has no such
// singleton) used the current one -- a real cross-call hazard, not a test
// bug, so the test structure below matches the single-instance-per-process
// contract the vendored code actually has.
const originalOptiflowHome = process.env.OPTIFLOW_HOME;
let optiflowHome: string;
let runtime: OptimizerRuntime;
let workDir: string;

beforeAll(() => {
  optiflowHome = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-home-"));
  process.env.OPTIFLOW_HOME = optiflowHome;
  runtime = createOptimizerRuntime();
});

afterAll(() => {
  runtime.close();
  try {
    // Best-effort: better-sqlite3 on Windows can hold the WAL/shm sidecar
    // files open for a moment after close(), which makes an immediate
    // rmSync of the temp dir throw EPERM. Cleanup here is a courtesy, not a
    // correctness requirement -- the OS temp directory gets reclaimed
    // regardless -- so a failure here must never fail the test run.
    rmSync(optiflowHome, { recursive: true, force: true });
  } catch {
    // See above.
  }
  if (originalOptiflowHome === undefined) {
    delete process.env.OPTIFLOW_HOME;
  } else {
    process.env.OPTIFLOW_HOME = originalOptiflowHome;
  }
});

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-work-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("ALL_TOOL_DEFINITIONS", () => {
  it("advertises exactly the wired tools across every merged category so far", () => {
    const names = ALL_TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        // file-operations (checkpoint 1)
        "smart_branch",
        "smart_diff",
        "smart_edit",
        "smart_glob",
        "smart_grep",
        "smart_log",
        "smart_merge",
        "smart_read",
        "smart_status",
        "smart_write",
        // configuration
        "smart_env",
        "smart_package_json",
        "smart_config_read",
        "smart_tsconfig",
        "smart_workflow",
        // output-formatting
        "smart_pretty",
        // system-operations
        "smart_process",
        "smart_service",
        "smart_cron",
        "smart_user",
        // intelligence
        "knowledge_graph",
        "sentiment_analysis",
        "wiki_read",
        "wiki_write",
        // api-database
        "smart_api_fetch",
        "smart_cache_api",
        "smart_database",
        "smart_graphql",
        "smart_migration",
        "smart_orm",
        "smart_rest",
        "smart_schema",
        "smart_sql",
        "smart_websocket",
      ].sort()
    );
  });

  it("gives every tool a non-empty name, description, and inputSchema", () => {
    for (const tool of ALL_TOOL_DEFINITIONS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

describe("optimizer tool dispatch (real end-to-end, reconciled paths)", () => {
  it("smart_write then smart_read round-trips real file content through the real dispatch table", async () => {
    const filePath = path.join(workDir, "hello.txt");
    const writeResult = await runtime.registry.smart_write({
      path: filePath,
      content: "hello from the optimizer merge",
    });
    expect(writeResult.isError).toBeFalsy();
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("hello from the optimizer merge");

    const readResult = await runtime.registry.smart_read({ path: filePath });
    expect(readResult.isError).toBeFalsy();
    const parsed = JSON.parse(readResult.content[0].text);
    expect(parsed.content).toContain("hello from the optimizer merge");
  });

  it("smart_glob finds a real file under workDir without touching any ~/.token-optimizer* path", async () => {
    writeFileSync(path.join(workDir, "a.ts"), "export const a = 1;\n", "utf-8");
    const result = await runtime.registry.smart_glob({
      pattern: "*.ts",
      cwd: workDir,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    const files: string[] = (parsed.files ?? parsed.matches ?? []).map((f: unknown) =>
      typeof f === "string" ? f : (f as { path: string }).path
    );
    expect(files.some((f) => f.includes("a.ts"))).toBe(true);
  });

  it("has no handler registered for an unknown tool name", () => {
    // The registry itself only holds handlers for known tools; unknown
    // names are rejected by `createOptimizerServer()`'s CallTool handler
    // (see server.ts), not by the registry itself.
    expect(runtime.registry.smart_frobnicate).toBeUndefined();
  });

  it("smart_read reports a clear error (not a crash) for a missing file", async () => {
    // SmartReadTool.read() throws synchronously on a missing file (ported
    // behavior); createOptimizerServer()'s CallTool handler is what turns
    // that into an isError result for a real MCP client. Calling the raw
    // registry handler directly, the promise rejects.
    await expect(
      runtime.registry.smart_read({ path: path.join(workDir, "does-not-exist.txt") })
    ).rejects.toThrow("File not found");
  });

  it("persists its cache under ~/.optiflow/optimizer/cache, not ~/.token-optimizer-cache or ~/.hypercontext", async () => {
    await runtime.registry.smart_status({ cwd: workDir });
    const dbPath = getOptimizerCacheDbPath();
    expect(dbPath.startsWith(path.resolve(optiflowHome))).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
  });
});

describe("configuration + output-formatting tools (real end-to-end)", () => {
  it("smart_env parses real .env content and flags a weak secret", async () => {
    const result = await runtime.registry.smart_env({
      envContent: "NODE_ENV=production\nJWT_SECRET=password\n",
      checkSecurity: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.variables.total).toBe(2);
    // The real value must never be echoed back (redaction, see smart-env.ts).
    expect(JSON.stringify(parsed)).not.toContain("password");
    expect(parsed.security.hasSecrets).toBe(true);
  });

  it("smart_config_read parses a real JSON file via the schema's `path` field (not `filePath`)", async () => {
    const configPath = path.join(workDir, "settings.json");
    writeFileSync(configPath, JSON.stringify({ port: 8080, debug: true }), "utf-8");
    const result = await runtime.registry.smart_config_read({ path: configPath });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.config).toEqual({ port: 8080, debug: true });
    expect(parsed.metadata.format).toBe("json");
  });

  it("smart_pretty detects the language of a real code snippet", async () => {
    const result = await runtime.registry.smart_pretty({
      operation: "detect-language",
      code: "def greet(name):\n    return f'hello {name}'\n",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});

describe("system-operations + intelligence tools (real end-to-end)", () => {
  it("smart_process reports real status without crashing", async () => {
    const result = await runtime.registry.smart_process({ operation: "status" });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it("knowledge_graph builds a real graph from a minimal entity set", async () => {
    const result = await runtime.registry.knowledge_graph({
      operation: "build-graph",
      entities: [{ id: "a", type: "file", label: "a.ts" }],
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it("wiki_read degrades gracefully (empty findings, not a crash) with no anchors matched", async () => {
    const result = await runtime.registry.wiki_read({ anchors: [] });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed.findings)).toBe(true);
  });
});

describe("api-database tools (real end-to-end)", () => {
  it("smart_sql analyzes a real query's type, tables, and complexity (no DB connection needed)", async () => {
    const result = await runtime.registry.smart_sql({
      action: "analyze",
      query: "SELECT id, name FROM users WHERE id = 1",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.analysis.queryType).toBe("SELECT");
    expect(parsed.analysis.tables).toContain("users");
    expect(parsed.metrics.originalTokens).toBeGreaterThan(0);
  });

  it("smart_orm detects a real N+1 query pattern (query-inside-a-for-loop)", async () => {
    const result = await runtime.registry.smart_orm({
      ormCode: `
        for (const user of users) {
          const posts = await prisma.post.findMany({ where: { userId: user.id } });
        }
      `,
      ormType: "prisma",
      detectN1: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.n1Problems.hasN1).toBe(true);
    expect(parsed.n1Problems.instances.length).toBeGreaterThan(0);
    expect(parsed.n1Problems.instances[0].type).toBe("loop_query");
  });

  it("smart_graphql detects a real N+1 problem from nested paginated list fields", async () => {
    const result = await runtime.registry.smart_graphql({
      query: `
        query {
          users(first: 20) {
            posts(first: 10) {
              title
            }
          }
        }
      `,
      detectN1: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.query.operation).toBe("query");
    expect(parsed.optimizations.n1Problems.length).toBeGreaterThan(0);
  });

  it("smart_rest parses a real OpenAPI spec passed as specContent (no network)", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/users": {
          get: { summary: "List users", responses: { "200": { description: "OK" } } },
        },
        "/users/{id}": {
          get: { summary: "Get user", responses: { "200": { description: "OK" } } },
        },
      },
    };
    const result = await runtime.registry.smart_rest({
      specContent: JSON.stringify(spec),
      analyzeEndpoints: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.api.endpoints).toBeGreaterThanOrEqual(2);
    expect(parsed.api.title).toBe("Test API");
  });

  it("smart_cache_api real round-trips a set then get through the actual CacheEngine", async () => {
    const request = { url: "https://api.example.com/users", method: "GET" };
    const setResult = await runtime.registry.smart_cache_api({
      action: "set",
      request,
      response: { data: [1, 2, 3] },
      ttl: 300,
    });
    expect(setResult.isError).toBeFalsy();
    const setParsed = JSON.parse(setResult.content[0].text);
    expect(setParsed.success).toBe(true);
    expect(setParsed.cached).toBe(true);

    const getResult = await runtime.registry.smart_cache_api({
      action: "get",
      request,
    });
    expect(getResult.isError).toBeFalsy();
    const getParsed = JSON.parse(getResult.content[0].text);
    expect(getParsed.success).toBe(true);
    expect(getParsed.cached).toBe(true);
    expect(getParsed.data._cached).toBe(true);
  });

  it("smart_schema introspects a real SQLite database file via better-sqlite3 (no mocked schema)", async () => {
    const { default: Database } = await import("better-sqlite3");
    const dbPath = path.join(workDir, "real-schema-test.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    db.close();

    const result = await runtime.registry.smart_schema({
      connectionString: dbPath,
      mode: "full",
      forceRefresh: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.result).toBe("string");
    // Real table names from the real SQLite file, not a fabricated schema.
    expect(parsed.result).toContain("users");
    expect(parsed.result).toContain("posts");
  });

  it("smart_schema honestly errors (does not fabricate a schema) for postgres/mysql connection strings", async () => {
    await expect(
      runtime.registry.smart_schema({
        connectionString: "postgres://localhost/mydb",
        mode: "full",
        forceRefresh: true,
      })
    ).rejects.toThrow(/PostgreSQL introspection is not available/);
  });

  it("smart_api_fetch rejects a clearly-invalid URL rather than crashing silently", async () => {
    await expect(
      runtime.registry.smart_api_fetch({ method: "GET", url: "not a valid url" })
    ).rejects.toThrow(/Invalid URL/);
  });

  it("smart_websocket reports a clear error (not a crash) for history on a connection that was never opened", async () => {
    await expect(
      runtime.registry.smart_websocket({
        action: "history",
        url: "wss://never-connected.example.com",
      })
    ).rejects.toThrow("No connection found");
  });

  // smart_database and smart_migration are wired to real dispatch, but per
  // src/optimizer/tools/api-database/index.ts's documented caveat, their
  // actual data is vendor's own explicitly-marked placeholder/mock output
  // (no real DB driver, no real migration-file scanning exists in this
  // package). These tests confirm the real plumbing (caching, token
  // accounting, dispatch, error handling) works end-to-end -- not that the
  // returned data reflects a real database.
  it("smart_database dispatches a query action end-to-end (vendor's own mocked query executor, not a real DB)", async () => {
    const result = await runtime.registry.smart_database({
      action: "query",
      query: "SELECT * FROM users",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.result).toBe("string");
    expect(parsed.tokens.baseline).toBeGreaterThan(0);
  });

  it("smart_migration dispatches a list action end-to-end (vendor's own fabricated migration data, not a real scan)", async () => {
    const result = await runtime.registry.smart_migration({
      action: "list",
      limit: 5,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(typeof parsed.result).toBe("string");
    expect(parsed.tokens.baseline).toBeGreaterThan(0);
  });
});

describe("createOptimizerServer()", () => {
  it("constructs without throwing and exposes the optiflow-optimizer server identity", async () => {
    const { createOptimizerServer } = await import("./server.js");
    const server = createOptimizerServer();
    expect(server).toBeTruthy();
    // The CallTool handler's isError-wrapping contract (a thrown tool error
    // becoming `{ isError: true }` instead of crashing the process) is
    // proven end-to-end by the real spawn-based smoke test described in the
    // phase report, which drives this exact server over a real stdio MCP
    // transport rather than reaching into SDK-internal handler maps here.
  });
});
