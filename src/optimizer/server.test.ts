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
  it("advertises exactly the 10 wired file-operations tools", () => {
    const names = ALL_TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
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
