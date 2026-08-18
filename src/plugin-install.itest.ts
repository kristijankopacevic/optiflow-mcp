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
import { mkdtempSync, rmSync, cpSync, existsSync } from "node:fs";
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
});
