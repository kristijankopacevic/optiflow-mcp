// Isolated-marketplace-install regression test. Encodes the manual
// verification from the native-dependency-hardening pass (see
// `core/cache-engine.ts`, `core/token-counter.ts`,
// `core/tokenizers/tiktoken-tokenizer.ts`, `analytics/analytics-storage.ts`,
// `analytics/optimization-storage.ts`, `native/kompress.ts`'s header
// comments) as a real automated test, so a future static top-level `import`
// of a native/heavy optional dependency can't silently reintroduce the
// exact crash this pass fixed: a marketplace install (`/plugin marketplace
// add` + `/plugin install`) copies ONLY the `plugin/` subtree with no
// `node_modules` -- Claude Code's automatic dependency install skips
// install scripts and doesn't run at all here (`plugin/package.json` has no
// `dependencies` field, deliberately). A static top-level `import` of an
// absent package poisons Node's entire ESM module-graph resolution before
// any code runs, crashing every one of the 76 `smart_*` tools at once, not
// just whichever one actually uses that package.
//
// Run via `npm run test:plugin-install` (NOT part of the main `npm test` --
// see `vitest.plugin-install.config.ts`'s header), which runs a fresh
// `node esbuild.config.mjs` first so this never checks a stale
// `plugin/dist`. This test then makes its OWN fresh copy of the (already
// rebuilt) `plugin/` tree into a brand-new temp directory outside this repo
// -- so there is no ancestor `package.json`/`node_modules` above it at all
// -- and cleans that directory up afterward.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, cpSync, existsSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/**
 * Env passed to every spawned child process below: a copy of this process's
 * own env with `NODE_PATH` stripped, so a spawned server/CLI can't
 * accidentally resolve modules from THIS repo's own `node_modules` (which
 * would mask exactly the failure this test exists to catch).
 */
function isolatedEnv(): Record<string, string> {
  const { NODE_PATH, ...rest } = process.env;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function runNode(
  args: string[],
  cwd: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: isolatedEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Same as `runNode`, but writes `stdin` to the child first — every Claude
 * Code hook is invoked exactly this way (JSON on stdin, JSON on stdout), so
 * this is the only shape that actually exercises the shipped hook bundles.
 */
function runNodeWithStdin(
  args: string[],
  cwd: string,
  stdin: string,
  extraEnv: Record<string, string> = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...isolatedEnv(), ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin?.end(stdin);
  });
}

/**
 * A synthetic TypeScript source file well over `largeFileBytes()` (25,600),
 * built from declarations CodeCompressor is supposed to keep verbatim
 * (imports, exported signatures, interfaces) wrapping bodies it is supposed
 * to elide. Generated rather than copied out of this repo so the test's
 * input can't drift when unrelated source files are edited.
 */
function generateLargeTypeScriptSource(functionCount: number): string {
  const lines: string[] = [
    'import { readFileSync, writeFileSync } from "node:fs";',
    'import path from "node:path";',
    "",
    "export interface WidgetRecord {",
    "  id: string;",
    "  label: string;",
    "  weight: number;",
    "  tags: string[];",
    "}",
    "",
  ];
  for (let i = 0; i < functionCount; i++) {
    lines.push(
      `export function transformWidget${i}(record: WidgetRecord, factor: number): WidgetRecord {`,
      "  const scaled = record.weight * factor;",
      "  const normalized = Number.isFinite(scaled) ? scaled : 0;",
      "  const tags = record.tags.filter((tag) => tag.length > 0);",
      "  const label = record.label.trim().toLowerCase();",
      "  const joined = tags.join(\",\");",
      "  const digest = path.basename(joined || label || record.id);",
      "  if (normalized > 1000) {",
      "    tags.push(\"heavy\");",
      "  } else if (normalized < 1) {",
      "    tags.push(\"light\");",
      "  }",
      "  const payload = { id: record.id, label, weight: normalized, tags, digest };",
      "  return payload;",
      "}",
      ""
    );
  }
  return lines.join("\n");
}

let tmpDir: string;
let pluginDir: string;
let serverPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "optiflow-plugin-install-test-"));
  pluginDir = path.join(tmpDir, "plugin");
  cpSync(path.join(repoRoot, "plugin"), pluginDir, { recursive: true });
  serverPath = path.join(pluginDir, "dist", "optimizer", "server.js");
  // Deliberately NOT seeding node_modules with anything (including
  // yaml/@iarna/toml, which -- like better-sqlite3/tiktoken/onnxruntime-node/
  // @huggingface/transformers -- are lazily loaded with a graceful failure
  // mode and are equally absent in a real marketplace install, since
  // `plugin/package.json` declares no `dependencies`). This is a genuinely
  // bare tree: the server must start with ZERO node_modules present.
});

afterAll(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("isolated marketplace-style plugin install (no node_modules present)", () => {
  it("has no ancestor package.json/node_modules above the isolated copy", () => {
    // Sanity check on the test's own setup, not the product -- if this ever
    // fails, the rest of this test file is not actually proving anything.
    expect(tmpDir.startsWith(repoRoot)).toBe(false);
    const parent = path.dirname(tmpDir);
    expect(existsSync(path.join(parent, "package.json"))).toBe(false);
    expect(existsSync(path.join(parent, "node_modules"))).toBe(false);
  });

  it("`optiflow doctor` exits 0 with no stack trace", async () => {
    const binPath = path.join(pluginDir, "bin", "optiflow");
    const result = await runNode([binPath, "doctor"], pluginDir);
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|at Module\._resolveFilename/);
    expect(result.code).toBe(0);
  });

  it(
    "MCP server starts without an import-time crash and serves the full tool list including smart_read",
    async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        cwd: path.dirname(serverPath),
        env: isolatedEnv(),
        stderr: "pipe",
      });

      const client = new Client({
        name: "plugin-install-isolation-test",
        version: "1.0.0",
      });

      let stderrOutput = "";
      try {
        await client.connect(transport);

        // Drain the server's stderr (the graceful-degradation warnings for
        // tiktoken/better-sqlite3 are expected here in a node_modules-less
        // environment) so a real crash would still be visible in the
        // assertion failure message below.
        transport.stderr?.on("data", (d: Buffer) => {
          stderrOutput += d.toString();
        });

        const { tools } = await client.listTools();

        expect(tools.length).toBeGreaterThan(0);
        expect(tools.some((t) => t.name === "smart_read")).toBe(true);
      } catch (err) {
        throw new Error(
          `MCP handshake against the isolated install failed: ${(err as Error).message}\n` +
            `Server stderr:\n${stderrOutput}`
        );
      } finally {
        await client.close().catch(() => {});
      }
    },
    30000
  );

  // The regression gate for the four shipping bugs found in one pass (MCP
  // field shape, wrapped signatures, missing tree-sitter grammars, ESM
  // `require`/`__dirname`). Every one of them worked in this repo and did
  // nothing on an installed machine, and every one passed a green `npm
  // test`, because the tests drove SOURCE in the DEV tree while the failure
  // only exists in the SHIPPED bundle in a BARE tree. The two tests above
  // prove the plugin *starts* in that tree; this one proves it actually
  // *compresses* there.
  //
  // It deliberately drives `hooks/pretooluse-optimizer.mjs` over stdin --
  // the exact bundle and the exact invocation Claude Code uses -- rather
  // than importing `compressCode` from source, which is precisely the kind
  // of test that stayed green through all four bugs. `compressCode` is
  // fail-open by design (any throw degrades to the plain redirect verdict),
  // so a missing grammar shows up here as a MISSING `additionalContext`,
  // never as a crash.
  it(
    "compresses a large source file from the bare tree (deny-and-substitute reaches the model)",
    async () => {
      const hookPath = path.join(pluginDir, "hooks", "pretooluse-optimizer.mjs");
      expect(existsSync(hookPath)).toBe(true);

      const workDir = path.join(tmpDir, "work");
      mkdirSync(workDir, { recursive: true });
      const sourcePath = path.join(workDir, "widgets.ts");
      const source = generateLargeTypeScriptSource(120);
      writeFileSync(sourcePath, source, "utf8");

      const sourceBytes = statSync(sourcePath).size;
      // Must clear `largeFileBytes()` (25,600) or the Read is simply allowed
      // and this test would pass vacuously.
      expect(sourceBytes).toBeGreaterThan(25_600);

      const result = await runNodeWithStdin(
        [hookPath],
        workDir,
        JSON.stringify({
          session_id: "plugin-install-compression-test",
          cwd: workDir,
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: { file_path: sourcePath },
        }),
        {
          // Keep all session scratch state inside the temp tree, so this
          // never reads or writes the real ~/.optiflow.
          OPTIFLOW_HOME: path.join(tmpDir, "optiflow-home"),
        }
      );

      expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/);
      expect(result.code).toBe(0);

      const output = JSON.parse(result.stdout);
      const specific = output.hookSpecificOutput ?? {};
      expect(specific.permissionDecision).toBe("deny");

      const substitute: string | undefined = specific.additionalContext;
      expect(
        substitute,
        "no additionalContext: compression silently failed open (the exact " +
          "signature of a missing grammar / unloadable web-tree-sitter runtime)"
      ).toBeTruthy();

      // Structure kept verbatim...
      expect(substitute).toContain('import { readFileSync, writeFileSync } from "node:fs"');
      expect(substitute).toContain("export interface WidgetRecord");
      expect(substitute).toContain("export function transformWidget0(");
      // ...bodies elided...
      expect(substitute).toMatch(/lines omitted/);
      expect(substitute).not.toContain('tags.push("heavy")');
      // ...and the model is told what it is looking at.
      expect(substitute).toContain("optiflow: structure-preserving compression");

      // The whole point: materially smaller than what Read would have put
      // in the context window. Measured against the source, not against a
      // fixture, so this number is real.
      const substituteBytes = Buffer.byteLength(substitute as string, "utf8");
      expect(substituteBytes).toBeLessThan(sourceBytes * 0.5);
    },
    60000
  );
});
