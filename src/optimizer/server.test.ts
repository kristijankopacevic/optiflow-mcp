import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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
        // build-systems
        "smart_build",
        "smart_docker",
        "smart_install",
        "smart_lint",
        "smart_logs",
        "smart_network",
        "smart_processes",
        "smart_system_metrics",
        "smart_test",
        "smart_typecheck",
        // code-analysis (8 of 9 real tools wired -- smart_typescript is
        // the one left deferred; see
        // src/optimizer/tools/code-analysis/index.ts's header)
        "smart_ast_grep",
        "smart_security",
        "smart_dependencies",
        "smart_complexity",
        "smart_refactor",
        "smart_imports",
        "smart_exports",
        "smart_symbols",
        // advanced-caching (all 10 real tools wired, zero deferrals -- see
        // src/optimizer/tools/advanced-caching/index.ts's header)
        "smart_cache",
        "predictive_cache",
        "cache_warmup",
        "cache_analytics",
        "cache_benchmark",
        "cache_compression",
        "cache_invalidation",
        "cache_optimizer",
        "cache_partition",
        "cache_replication",
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

describe("build-systems tools (real end-to-end)", () => {
  it(
    "smart_typecheck runs the real TypeScript compiler (--noEmit) against this actual repo, no fabricated success",
    async () => {
      const result = await runtime.registry.smart_typecheck({
        projectRoot: process.cwd(),
        force: true,
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      // This repo's own `npx tsc --noEmit` gate is required to be clean, so a
      // real run against it must report zero errors -- not a fabricated pass.
      expect(parsed.summary.success).toBe(true);
      expect(parsed.summary.errorCount).toBe(0);
      expect(parsed._metrics.originalTokens).toBeGreaterThanOrEqual(0);
    },
    120_000
  );

  it(
    "smart_build really invokes tsc and emits a real compiled file (not a mocked build)",
    async () => {
      // A real fixture INSIDE the repo tree (not under os.tmpdir()) so
      // run-node-bin.ts's resolveBinScript walks upward and finds this
      // repo's own node_modules/typescript -- a temp dir under the system
      // tmp root has no such ancestor. Emits into its own isolated `out/`
      // subdirectory so nothing outside the fixture is touched, and is
      // deleted afterward regardless of outcome.
      const fixtureDir = path.join(
        process.cwd(),
        `.tmp-smart-build-fixture-${Date.now()}`
      );
      mkdirSync(fixtureDir, { recursive: true });
      try {
        writeFileSync(
          path.join(fixtureDir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              target: "ES2022",
              module: "commonjs",
              outDir: "out",
              skipLibCheck: true,
              strict: false,
            },
            include: ["*.ts"],
          }),
          "utf-8"
        );
        writeFileSync(
          path.join(fixtureDir, "a.ts"),
          "export const a: number = 1;\n",
          "utf-8"
        );

        const result = await runtime.registry.smart_build({
          projectRoot: fixtureDir,
          force: true,
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.summary.success).toBe(true);
        expect(parsed.summary.errorCount).toBe(0);
        // Proof this was a real tsc invocation, not a mocked result: the
        // compiled file actually exists on disk afterward.
        expect(existsSync(path.join(fixtureDir, "out", "a.js"))).toBe(true);
        expect(parsed._metrics.originalTokens).toBeGreaterThanOrEqual(0);
      } finally {
        rmSync(fixtureDir, { recursive: true, force: true });
      }
    },
    120_000
  );

  it("smart_lint degrades gracefully (a real MissingProjectTool error, not a crash) because eslint is not installed anywhere up this machine's directory tree", async () => {
    // Confirmed by direct inspection: no node_modules/eslint exists in this
    // repo or any parent directory up to and including C:\ on this dev
    // machine, so this exercises the tool's real "not installed" path
    // rather than a fabricated one.
    await expect(
      runtime.registry.smart_lint({ force: true })
    ).rejects.toThrow(/eslint/i);
  });

  it("smart_install rejects an unsafe package name (real CWE-78 guard) before ever spawning a package manager", async () => {
    // No real install is attempted -- the validation that rejects this runs
    // before any subprocess is spawned, so this is a real negative test with
    // no side effects on this repo's own node_modules.
    await expect(
      runtime.registry.smart_install({ packages: ["-evil"] })
    ).rejects.toThrow(/must not start with/);
  });

  it(
    "smart_test really runs a fixture project's own tests via node's built-in test runner (real pass/fail counts, not fabricated)",
    async () => {
      writeFileSync(
        path.join(workDir, "package.json"),
        JSON.stringify({
          name: "smart-test-fixture",
          private: true,
          scripts: { test: "node --test" },
        }),
        "utf-8"
      );
      writeFileSync(
        path.join(workDir, "example.test.mjs"),
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "",
          "test('adds numbers', () => { assert.strictEqual(1 + 1, 2); });",
          "",
        ].join("\n"),
        "utf-8"
      );

      const result = await runtime.registry.smart_test({
        projectRoot: workDir,
        framework: "node",
        force: true,
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.summary.framework).toBe("node");
      expect(parsed.summary.total).toBeGreaterThanOrEqual(1);
      expect(parsed.summary.passed).toBeGreaterThanOrEqual(1);
      expect(parsed.summary.failed).toBe(0);
      expect(parsed.metrics.originalTokens).toBeGreaterThan(0);
    },
    60_000
  );

  it(
    "smart_processes lists real running processes on this machine (via wmic/CIM, not fabricated rows)",
    async () => {
      const result = await runtime.registry.smart_processes({ limit: 5 });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.summary.totalProcesses).toBeGreaterThan(0);
      expect(parsed.metrics.originalTokens).toBeGreaterThan(0);
    },
    120_000
  );

  it("smart_logs parses real ISO-timestamped lines from a real log file on disk", async () => {
    const logPath = path.join(workDir, "app.log");
    writeFileSync(
      logPath,
      [
        "2024-01-01T12:00:00.000Z [ERROR] disk full",
        "2024-01-01T12:00:01.000Z [WARN] retrying connection",
        "2024-01-01T12:00:02.000Z [INFO] request completed",
      ].join("\n") + "\n",
      "utf-8"
    );

    const result = await runtime.registry.smart_logs({ sources: [logPath] });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary.totalEntries).toBe(3);
    expect(parsed.summary.errorCount).toBe(1);
    expect(parsed.metrics.originalTokens).toBeGreaterThan(0);
  });

  it("smart_network resolves a real hostname via DNS without depending on internet access (localhost)", async () => {
    const result = await runtime.registry.smart_network({
      operation: "dns",
      hostnames: ["localhost"],
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.dns?.[0]?.resolved).toBe(true);
    expect(parsed.dns?.[0]?.addresses.length).toBeGreaterThan(0);
  });

  it(
    "smart_system_metrics reports real CPU/memory/disk metrics from this machine (via os module + wmic, not fabricated)",
    async () => {
      const result = await runtime.registry.smart_system_metrics({});
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.summary.success).toBe(true);
      expect(parsed.cpu.cores).toBeGreaterThan(0);
      expect(parsed.metrics.originalTokens).toBeGreaterThan(0);
    },
    60_000
  );
});

describe("code-analysis tools (real end-to-end)", () => {
  // smart_ast_grep is deliberately NOT exercised here: with `@ast-grep/cli`
  // not installed anywhere on this machine (confirmed directly -- no
  // node_modules/@ast-grep, no `sg`/`ast-grep` on PATH), a real call falls
  // through to the tool's own `npx --package @ast-grep/cli` fetch path,
  // which needs network access and can download a multi-megabyte native
  // binary -- slow and non-deterministic for this suite. It IS exercised in
  // the manual stdio smoke test (see the phase report) where a longer,
  // one-off real run is acceptable.

  it("smart_security really flags a hardcoded API key in a real fixture file via regex pattern matching (not a mocked finding)", async () => {
    writeFileSync(
      path.join(workDir, "config.ts"),
      "export const apiKey = 'sk-proj-abcdefghijklmnopqrstuvwx';\n",
      "utf-8"
    );

    const result = await runtime.registry.smart_security({
      projectRoot: workDir,
      force: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    // `summary.success` means "no critical/high findings" (secure), not
    // "the scan ran" -- a real critical secrets finding correctly makes
    // this false.
    expect(parsed.summary.success).toBe(false);
    expect(parsed.summary.filesScanned).toBeGreaterThanOrEqual(1);
    expect(parsed.summary.totalFindings).toBeGreaterThanOrEqual(1);
    const categories = parsed.findingsByCategory.map((c: any) => c.category);
    expect(categories).toContain("secrets");
  });

  it(
    "smart_security honors a per-call projectRoot on the shared singleton (regression test for the projectRoot-staleness fix)",
    async () => {
      // Call 1: a directory WITH a real finding.
      const vulnDir = mkdtempSync(path.join(tmpdir(), "optiflow-sec-vuln-"));
      writeFileSync(
        path.join(vulnDir, "config.ts"),
        "export const apiKey = 'sk-proj-abcdefghijklmnopqrstuvwx';\n",
        "utf-8"
      );
      // Call 2: a DIFFERENT, clean directory with no findings at all.
      const cleanDir = mkdtempSync(path.join(tmpdir(), "optiflow-sec-clean-"));
      writeFileSync(
        path.join(cleanDir, "clean.ts"),
        "export const greeting = 'hello';\n",
        "utf-8"
      );

      try {
        const first = await runtime.registry.smart_security({
          projectRoot: vulnDir,
          force: true,
        });
        const firstParsed = JSON.parse(first.content[0].text);
        expect(firstParsed.summary.totalFindings).toBeGreaterThanOrEqual(1);

        // Same shared singleton instance, a SECOND call with a different
        // projectRoot. Before the fix, `SmartSecurity.run()` never re-read
        // `options.projectRoot`, so this would silently keep scanning
        // `vulnDir` (or the server's own cwd) instead of `cleanDir`.
        const second = await runtime.registry.smart_security({
          projectRoot: cleanDir,
          force: true,
        });
        const secondParsed = JSON.parse(second.content[0].text);
        expect(secondParsed.summary.totalFindings).toBe(0);
        expect(secondParsed.summary.filesScanned).toBeGreaterThanOrEqual(1);
      } finally {
        rmSync(vulnDir, { recursive: true, force: true });
        rmSync(cleanDir, { recursive: true, force: true });
      }
    },
    30_000
  );

  it("smart_dependencies really parses real imports/exports via @babel/parser from a real .ts fixture (proves the typescript-estree substitution)", async () => {
    writeFileSync(
      path.join(workDir, "util.ts"),
      "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n",
      "utf-8"
    );
    writeFileSync(
      path.join(workDir, "main.ts"),
      "import { greet } from './util';\n\nexport const message = greet('world');\n",
      "utf-8"
    );

    const result = await runtime.registry.smart_dependencies({
      cwd: workDir,
      mode: "graph",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.graph).toBeTruthy();
    expect(parsed.graph.nodes).toEqual(
      expect.arrayContaining(["main.ts", "util.ts"])
    );
    // main.ts really imports util.ts -- a real edge from real Babel-parsed
    // AST, not a fabricated graph.
    expect(parsed.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "main.ts", to: "util.ts" }),
      ])
    );
  });

  it("smart_dependencies degrades gracefully on an unparseable file (real parse-error skip, not a crash)", async () => {
    writeFileSync(
      path.join(workDir, "good.ts"),
      "export const ok = 1;\n",
      "utf-8"
    );
    writeFileSync(
      path.join(workDir, "broken.ts"),
      "export const broken = ((( not valid syntax at all ]",
      "utf-8"
    );

    const result = await runtime.registry.smart_dependencies({
      cwd: workDir,
      mode: "graph",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    // The broken file is silently skipped (analyzeFile returns null on a
    // parse error); the valid file is still analyzed for real.
    expect(parsed.graph.nodes).toContain("good.ts");
    expect(parsed.graph.nodes).not.toContain("broken.ts");
  });

  it("smart_complexity computes a real, hand-verifiable cyclomatic complexity via @babel/parser (proves the classic-Compiler-API port)", async () => {
    const src = `
function f(a, b) {
  if (a && b) {
    return 1;
  } else if (a) {
    return 2;
  }
  for (let i = 0; i < 10; i++) {}
  return 0;
}
`;
    const result = await runtime.registry.smart_complexity({
      fileContent: src,
      force: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.functions.length).toBe(1);
    expect(parsed.functions[0].name).toBe("f");
    // base(1) + if + else-if(also an IfStatement) + for + `&&` = 5, hand
    // counted against the if/for/&&/catch decision-point rule this tool
    // implements -- not just "returns something".
    expect(parsed.functions[0].complexity.cyclomatic).toBe(5);
  });

  it("smart_complexity throws a real SyntaxError on malformed input instead of ts.createSourceFile's old silent recovery (documented behavior difference)", async () => {
    // SmartComplexityTool.run() throws synchronously on @babel/parser's own
    // parse failure (ported behavior); createOptimizerServer()'s CallTool
    // handler is what turns that into an isError result for a real MCP
    // client -- calling the raw registry handler directly, the promise
    // rejects, matching this file's established convention for error paths
    // (see smart_read's identical-shape test above).
    await expect(
      runtime.registry.smart_complexity({
        fileContent: "function broken( { return )",
        force: true,
      })
    ).rejects.toThrow();
  });

  it("smart_refactor flags deep if-nesting, single-letter variables, and repeated magic numbers from real @babel/parser AST shape (not fabricated)", async () => {
    const src = `
function f(a, b, c) {
  if (a) {
    if (b) {
      if (c) {
        return 1;
      }
    }
  }
  const p = 77; const q = 77; const r = 77;
  return p + q + r;
}
`;
    const result = await runtime.registry.smart_refactor({
      fileContent: src,
      force: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(
      parsed.suggestions.some(
        (s: any) =>
          s.type === "simplify-conditional" && s.message.includes("nested")
      )
    ).toBe(true);
    expect(
      parsed.suggestions.some((s: any) => s.type === "improve-naming")
    ).toBe(true);
    expect(
      parsed.suggestions.some((s: any) => s.type === "extract-constant")
    ).toBe(true);
  });

  it("smart_imports extracts import/require/dynamic-import statements and flags a real unused import via real @babel/parser AST (not typescript-estree)", async () => {
    const src = `import def, { a as b, c } from './mod.js';
import * as ns from './mod2.js';
const r = require('./mod3.js');
async function f() { await import('./dyn.js'); }
console.log(def, ns, r);
`;
    const result = await runtime.registry.smart_imports({
      fileContent: src,
      force: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.imports.length).toBe(4);
    const named = parsed.imports.find((i: any) => i.module === "./mod.js");
    // Local/exported-name inversion (Babel's local vs. imported) resolved
    // correctly: `b` is the local binding, `a` the aliased original name.
    expect(named.imports).toEqual(
      expect.arrayContaining([
        { name: "def", isDefault: true },
        { name: "b", alias: "a" },
      ])
    );
    expect(parsed.imports.find((i: any) => i.type === "dynamic")?.module).toBe(
      "./dyn.js"
    );
    // `c` is never referenced anywhere in the source -- a real unused-import
    // finding computed from the used-symbol walk, not fabricated.
    const unusedNames = parsed.imports.flatMap(
      (i: any) => i.unusedImports || []
    );
    expect(unusedNames).toContain("c");
    expect(unusedNames).not.toContain("def");
    // Line numbers are exactly right (catches the ts 0-based/Babel
    // 1-based `+1` off-by-one trap this port had to avoid).
    expect(named.location.line).toBe(1);
  });

  it("smart_exports extracts named/default/reexport/namespace exports with correct aliasing via real @babel/parser AST", async () => {
    const src = `export interface Foo { a: number; }
export function f(a, b) {}
export const x = 1, y = 2;
export default function baz() {}
export { a as b } from './x.js';
export * from './y.js';
export * as ns from './z.js';
`;
    const result = await runtime.registry.smart_exports({
      fileContent: src,
      force: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    const byName = (n: string) =>
      parsed.exports.find((e: any) => e.name === n);
    expect(byName("Foo")?.kind).toBe("interface");
    expect(byName("f")?.kind).toBe("function");
    expect(byName("x")?.kind).toBe("variable");
    expect(byName("baz")?.type).toBe("default");
    // Babel's local/exported fields are the mirror image of ts's
    // name/propertyName -- verified this port didn't get them backwards.
    const reexport = parsed.exports.find(
      (e: any) => e.name === "b" && e.fromModule === "./x.js"
    );
    expect(reexport.originalName).toBe("a");
    expect(reexport.type).toBe("reexport");
    expect(
      parsed.exports.find(
        (e: any) => e.name === "*" && e.fromModule === "./y.js"
      )?.type
    ).toBe("namespace");
    expect(
      parsed.exports.find(
        (e: any) => e.name === "ns" && e.fromModule === "./z.js"
      )?.type
    ).toBe("namespace");
  });

  it("smart_symbols extracts declared symbols with scope/exported/documentation but WITHOUT type or references (documented capability loss, not silently faked)", async () => {
    writeFileSync(
      path.join(workDir, "symbols.ts"),
      `
/** A documented function. */
export function documented() {}

class C {
  method() {}
  prop = 1;
}

export interface Foo { a: number; }
`,
      "utf-8"
    );

    const result = await runtime.registry.smart_symbols({
      filePath: path.join(workDir, "symbols.ts"),
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    const documented = parsed.symbols.find((s: any) => s.name === "documented");
    expect(documented.exported).toBe(true);
    expect(documented.kind).toBe("function");
    expect(documented.documentation).toBe("A documented function.");
    // The real capability loss this checkpoint documented rather than
    // faked: no type checker means no `type` field and no scope-aware
    // `references` count -- verified genuinely absent, not just unset.
    expect("type" in documented).toBe(false);
    expect("references" in documented).toBe(false);
    const method = parsed.symbols.find((s: any) => s.name === "method");
    expect(method.kind).toBe("method");
    expect(method.scope).toBe("class");
    const iface = parsed.symbols.find((s: any) => s.name === "Foo");
    expect(iface.kind).toBe("interface");
    expect(iface.exported).toBe(true);
  });
});

describe("advanced-caching tools (real end-to-end)", () => {
  // NOTE ON TIMER SAFETY: `cache_replication` and `cache_invalidation`'s
  // shared instances start real background timers from their OWN
  // constructors (see tools/advanced-caching/index.ts's header for the
  // real defect this checkpoint found and fixed: those timers are now
  // `.unref()`'d so they never block this file's own process exit). This
  // block additionally avoids `cache_warmup`'s `operation: 'schedule'` and
  // `cache_replication`'s `operation: 'sync'`/`'configure'` (auto-sync-
  // triggering) on purpose -- not because they'd hang after the fix, but to
  // keep this suite free of any reliance on background timing at all.

  it("smart_cache set/get round-trips a real value through a real cache-hit, and a never-set key misses gracefully (not a crash)", async () => {
    const key = `advanced-caching-test-${Date.now()}`;

    // Cache miss: nothing has been set for this key yet.
    const missResult = await runtime.registry.smart_cache({
      operation: "get",
      key,
    });
    expect(missResult.isError).toBeFalsy();
    const missParsed = JSON.parse(missResult.content[0].text);
    expect(missParsed.success).toBe(true);
    expect(missParsed.data.value).toBeUndefined();

    // Real write (default writeMode is 'write-through', so this goes
    // straight to the shared CacheEngine with no background timer involved).
    const setResult = await runtime.registry.smart_cache({
      operation: "set",
      key,
      value: "hello from advanced-caching",
    });
    expect(setResult.isError).toBeFalsy();
    const setParsed = JSON.parse(setResult.content[0].text);
    expect(setParsed.success).toBe(true);
    expect(setParsed.data.metadata.tier).toBe("L1");

    // Cache hit: the exact value just written comes back from L1.
    const hitResult = await runtime.registry.smart_cache({
      operation: "get",
      key,
    });
    expect(hitResult.isError).toBeFalsy();
    const hitParsed = JSON.parse(hitResult.content[0].text);
    expect(hitParsed.success).toBe(true);
    expect(hitParsed.data.value).toBe("hello from advanced-caching");
    expect(hitParsed.data.metadata.hits).toBeGreaterThanOrEqual(1);
  });

  it("cache_compression compresses then decompresses real repetitive text back to byte-identical content", async () => {
    // Long and highly repetitive so gzip's own header/frame overhead can't
    // dominate the result -- a short string can legitimately come back
    // LARGER after compression, which would be a real (if surprising)
    // result, not a bug; this input avoids that ambiguity.
    const original = "hello world ".repeat(500);

    const compressResult = await runtime.registry.cache_compression({
      operation: "compress",
      data: original,
      algorithm: "gzip",
    });
    expect(compressResult.isError).toBeFalsy();
    const compressParsed = JSON.parse(compressResult.content[0].text);
    expect(compressParsed.success).toBe(true);
    // JSON round-trips a Buffer as { type: "Buffer", data: number[] }.
    const compressedBuffer = Buffer.from(compressParsed.data.compressed.data);
    // Real compression on real repetitive text should shrink it.
    expect(compressedBuffer.length).toBeLessThan(Buffer.byteLength(original));

    const decompressResult = await runtime.registry.cache_compression({
      operation: "decompress",
      data: compressedBuffer,
    });
    expect(decompressResult.isError).toBeFalsy();
    const decompressParsed = JSON.parse(decompressResult.content[0].text);
    expect(decompressParsed.success).toBe(true);
    // Same Buffer-through-JSON reconstruction as `compressedBuffer` above.
    const decompressedBuffer = Buffer.from(decompressParsed.data.decompressed.data);
    expect(decompressedBuffer.toString("utf-8")).toBe(original);
  });

  it("predictive_cache records a real access then retrieves it via get-patterns", async () => {
    const key = "hot-file.ts";

    const recordResult = await runtime.registry.predictive_cache({
      operation: "record-access",
      key,
    });
    expect(recordResult.isError).toBeFalsy();
    expect(JSON.parse(recordResult.content[0].text).success).toBe(true);

    const patternsResult = await runtime.registry.predictive_cache({
      operation: "get-patterns",
      key,
    });
    expect(patternsResult.isError).toBeFalsy();
    const parsed = JSON.parse(patternsResult.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.patterns.length).toBeGreaterThan(0);
    expect(parsed.data.patterns[0].key).toBe(key);
  });

  it("cache_analytics dashboard degrades gracefully (real synthetic-free structure, not a crash) with zero prior activity", async () => {
    const result = await runtime.registry.cache_analytics({
      operation: "dashboard",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.dashboard.performance).toBeTruthy();
    expect(parsed.data.dashboard.health).toBeTruthy();
  });

  it("cache_invalidation invalidates a key that was never cached without crashing (graceful miss)", async () => {
    const result = await runtime.registry.cache_invalidation({
      operation: "invalidate",
      key: `never-cached-${Date.now()}`,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data.invalidatedKeys)).toBe(true);
  });

  it("cache_optimizer analyze() returns real synthetic metrics (documented fallback, not a crash) with no access history yet", async () => {
    const result = await runtime.registry.cache_optimizer({
      operation: "analyze",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.metrics).toBeTruthy();
    expect(typeof parsed.data.metrics.hitRate).toBe("number");
  });

  it("cache_partition creates a real partition then lists it back", async () => {
    const partitionId = `partition-${Date.now()}`;

    const createResult = await runtime.registry.cache_partition({
      operation: "create-partition",
      partitionId,
      strategy: "hash",
    });
    expect(createResult.isError).toBeFalsy();
    expect(JSON.parse(createResult.content[0].text).success).toBe(true);

    const listResult = await runtime.registry.cache_partition({
      operation: "list-partitions",
    });
    expect(listResult.isError).toBeFalsy();
    const parsed = JSON.parse(listResult.content[0].text);
    expect(parsed.success).toBe(true);
    expect(
      parsed.data.partitions.some((p: any) => p.id === partitionId)
    ).toBe(true);
  });

  it("cache_replication reports real node status without ever starting a live sync (no network, single simulated primary node)", async () => {
    const result = await runtime.registry.cache_replication({
      operation: "status",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data.nodes)).toBe(true);
    expect(parsed.data.nodes.length).toBeGreaterThanOrEqual(1);
    expect(parsed.data.nodes[0].health).toBe("healthy");
  });

  it("cache_warmup immediate dry-run simulates warming real keys without requiring a live data fetcher", async () => {
    const result = await runtime.registry.cache_warmup({
      operation: "immediate",
      keys: ["a", "b", "c"],
      dryRun: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.simulation).toBeTruthy();
  });

  it("cache_benchmark runs a real (short, single-worker) latency test against the shared cache", async () => {
    const result = await runtime.registry.cache_benchmark({
      operation: "latency-test",
      config: { name: "test", strategy: "LRU", ttl: 60 },
      workload: { type: "read-heavy", duration: 1, concurrency: 1, keyCount: 20 },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(typeof parsed.latencyDistribution.mean).toBe("number");
  }, 10000);
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
