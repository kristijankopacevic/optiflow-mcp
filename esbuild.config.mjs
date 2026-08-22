// esbuild config for optiflow-mcp.
//
// Bundles each CLI-callable / hook entry point into plugin/dist/**, which is
// intentionally committed to git (see .gitattributes: `plugin/dist/** -diff
// linguist-generated`) so that plugin installs never need to run a build.
//
// NOTE (Phase 1 scaffold): most of the entry files below do not exist yet —
// they land in Phase 2+ (config/core), Phase 3 (chop), Phase 4 (statusline),
// Phase 5 (toon), Phase 6 (transcript/report), Phase 7 (handoff). This script
// filters `entryPoints` down to whatever currently exists on disk and warns
// (rather than throws) about the rest, so `npm run build` is always safe to
// run during the scaffold period. It will only fully succeed once Phase 2+
// adds the source files. Do not read a clean `npm run build` exit as proof
// those modules are implemented.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bundled to `plugin/dist/**` (committed, see header comment) — CLI `bin/`
 * entries and anything else invoked by requiring a built `.js` file
 * directly (`plugin/bin/optiflow` -> `plugin/dist/cli/index.js`,
 * `plugin/bin/optiflow-chop` -> `plugin/dist/chop/wrapper.js`).
 * @type {{ in: string; out: string }[]}
 */
const plannedEntries = [
  { in: "src/cli/index.ts", out: "plugin/dist/cli/index" },
  { in: "src/chop/wrapper.ts", out: "plugin/dist/chop/wrapper" },
  { in: "src/statusline/render.ts", out: "plugin/dist/statusline/render" },
  { in: "src/handoff/checkpoint.ts", out: "plugin/dist/handoff/checkpoint" },
  { in: "src/handoff/restore.ts", out: "plugin/dist/handoff/restore" },
  { in: "src/transcript/render.ts", out: "plugin/dist/transcript/render" },
  // Phase 5 (optimizer merge): the merged MCP server, launched by
  // plugin/.mcp.json via `node plugin/dist/optimizer/server.js`.
  { in: "src/optimizer/server.ts", out: "plugin/dist/optimizer/server" },
];

/**
 * Packages that must stay real `require`/`import` calls at runtime rather
 * than being inlined by esbuild: `better-sqlite3` ships a native `.node`
 * addon (bundling would break the addon's own relative-path loading logic),
 * and `tiktoken` ships a `.wasm` file it loads relative to its own package
 * directory at runtime for the same reason. Both need to stay resolvable
 * from `node_modules` at the bundle's runtime location.
 *
 * `yaml` and `@iarna/toml` are external for a different reason, found via a
 * real stdio smoke test of the built server (not a guess): their CJS
 * interop shims do a `require('process')` that esbuild's ESM-output
 * `__require2` wrapper cannot satisfy ("Dynamic require of 'process' is not
 * supported"), crashing the server at import time. Bundling works for a
 * plain `require`, just not this specific CJS/ESM interop pattern.
 *
 * `onnxruntime-node`/`@huggingface/transformers` (v2 Phase 5c: wired into
 * `src/optimizer/tools/file-operations/smart-read.ts`'s Kompress path,
 * pulling both into `plugin/dist/optimizer/server.js`'s bundle for the
 * first time) hit the exact same `.node`-native-addon class of problem as
 * `better-sqlite3` — confirmed by running `npm run build` before and after
 * this wiring landed: esbuild has no loader for the platform-specific
 * `onnxruntime_binding.node` files `onnxruntime-node`'s own `require()`
 * resolves at runtime (including the copy `@huggingface/transformers`
 * vendors as its own nested dependency), and fails the build outright
 * rather than silently producing a broken bundle.
 *
 * UPDATED RATIONALE (post native-dependency-hardening pass): none of these
 * four packages, nor `better-sqlite3`, is guaranteed to be present in a real
 * marketplace install — Claude Code's automatic `npm ci --ignore-scripts`
 * dependency install always skips install scripts (breaking any package
 * that needs one to produce a working native binary) and doesn't ship at
 * all unless `plugin/package.json` declares a `dependencies` field, which
 * it deliberately doesn't (see that file). So every one of
 * `src/optimizer/core/tokenizers/tiktoken-tokenizer.ts`,
 * `src/optimizer/core/token-counter.ts`, `src/optimizer/core/cache-engine.ts`,
 * `src/optimizer/analytics/analytics-storage.ts`,
 * `src/optimizer/analytics/optimization-storage.ts`, and
 * `src/native/kompress.ts` now treats these as LAZY, OPTIONAL ACCELERATORS:
 * loaded via a deferred `require()`/dynamic `import()` at first real use,
 * wrapped in try/catch, falling back to a pure-JS/in-memory/JSONL
 * implementation with the exact same public API on any failure (missing
 * package, wrong ABI, unsupported Node version, etc.) — see each of those
 * files' own header comments for the specifics. Staying `external` here is
 * STILL required regardless of that change: esbuild has no loader for a
 * native `.node` addon or a `.wasm`-relative-path loader whether it's
 * resolved statically or dynamically, so these packages can't be inlined
 * either way. What changed is the FAILURE MODE on their absence: graceful,
 * per-feature degradation instead of the whole server (all 76 `smart_*`
 * tools) crashing at process start, because a static top-level `import` of
 * any of these — even in a file whose functionality most tool calls never
 * touch — poisons Node's entire ESM module-graph resolution before any code
 * runs.
 * @type {string[]}
 */
const nativeExternals = [
  "better-sqlite3",
  "tiktoken",
  "yaml",
  "@iarna/toml",
  "onnxruntime-node",
  "@huggingface/transformers",
];

/**
 * Bundled directly to `plugin/hooks/*.mjs` (NOT `plugin/dist/`) — these are
 * Claude Code hook entries referenced by `plugin/hooks/hooks.json` via
 * `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs`, mirroring exactly how the
 * vendored token-optimizer-mcp plugin's own hooks.json references its
 * hook scripts (`vendor/token-optimizer-mcp/plugin/hooks/hooks.json`).
 * Building with an explicit `.mjs` output extension (rather than the `.js`
 * used for `plugin/dist/**`) matters here specifically: if Claude Code's
 * installed plugin tree is rooted such that there's no `package.json` with
 * `"type": "module"` visible above `plugin/hooks/`, a plain `.js` file
 * would be parsed as CommonJS and every `import` in it would fail at
 * runtime with "Cannot use import statement outside a module" — the `.mjs`
 * extension forces ESM regardless of any ambient `package.json`.
 * @type {{ in: string; out: string }[]}
 */
const hookEntries = [
  { in: "src/chop/pretooluse.ts", out: "pretooluse-chop" },
  { in: "src/chop/posttooluse-mcp.ts", out: "posttooluse-mcp" },
  // Phase 7 (Module 4 - handoff): auto-checkpoint on PreCompact/SessionEnd,
  // plus the broad-matcher PreToolUse activity-beacon hook (see
  // src/handoff/activity-hook.ts for why this is a second, separate
  // PreToolUse hook rather than piggybacking on pretooluse-chop above).
  { in: "src/handoff/precompact-hook.ts", out: "precompact-handoff" },
  { in: "src/handoff/sessionend-hook.ts", out: "sessionend-handoff" },
  // Reads those checkpoints back on SessionStart[compact] — the one moment
  // a checkpoint exists to survive. See src/handoff/sessionstart-hook.ts.
  { in: "src/handoff/sessionstart-hook.ts", out: "sessionstart-handoff" },
  { in: "src/handoff/activity-hook.ts", out: "pretooluse-activity" },
  // v2 Phase 5b: token-optimizer's ported enforcement layer. Imports only
  // sibling ./lib/*.ts files plus src/optimizer/paths.ts and
  // src/core/hook-io.ts — no better-sqlite3/tiktoken in this closure, so
  // this bundles the same way as the other hook entries above (no
  // `external: nativeExternals` needed, unlike src/optimizer/server.ts).
  { in: "src/optimizer/hooks/pretooluse.ts", out: "pretooluse-optimizer" },
  { in: "src/optimizer/hooks/precompact.ts", out: "precompact-optimizer" },
];

/**
 * Bundled to `plugin/scripts/*.mjs` — Module 3's statusline entry point,
 * invoked by a user's/project's OWN `statusLine.command` (see
 * docs/statusline-manual-setup.md; U1 finding: no plugin-manifest route
 * exists for `statusLine`, so this is invoked the same way a hand-written
 * script would be, just shipped inside the plugin tree). Uses the exact
 * same `.mjs`-forced-ESM convention as `hookEntries` above, for the same
 * reason (no guaranteed `"type": "module"` `package.json` visible above
 * this path once installed) — just a different `outdir` since this isn't a
 * Claude Code hook entry.
 * @type {{ in: string; out: string }[]}
 */
const scriptEntries = [{ in: "src/statusline/cli.ts", out: "statusline" }];

/**
 * Injected at the top of every ESM bundle so a CommonJS `require` exists at
 * runtime.
 *
 * `web-tree-sitter` is an Emscripten build that calls `require("fs")`,
 * `require("path")` and `require("crypto")` internally when it loads its
 * `.wasm` runtime. Bundled into ESM those calls hit esbuild's
 * `__require` shim, which throws `Dynamic require of "fs" is not
 * supported` -- the SAME failure mode already documented on
 * `nativeExternals` for `yaml`/`@iarna/toml`.
 *
 * That throw was swallowed by CodeCompressor's fail-open passthrough, so
 * the symptom was silent: `smart_read`'s compression branch and the
 * PreToolUse deny-and-substitute path returned files uncompressed on every
 * installed machine, while the in-repo tests (which import the unbundled
 * source, where `require` is unnecessary) all passed.
 *
 * Marking web-tree-sitter external instead would be the other option, but
 * that only moves the problem: an install ships no `node_modules` for it to
 * be resolved from. Defining `require` keeps it bundled AND working. Only
 * Node builtins are ever requested through it.
 */
const esmRequireBanner = {
  js: [
    'import { createRequire as __optiflowCreateRequire } from "node:module";',
    'import { fileURLToPath as __optiflowFileURLToPath } from "node:url";',
    'import { dirname as __optiflowDirname } from "node:path";',
    'const require = __optiflowCreateRequire(import.meta.url);',
    'const __filename = __optiflowFileURLToPath(import.meta.url);',
    'const __dirname = __optiflowDirname(__filename);',
  ].join(String.fromCharCode(10)),
};

function partitionByExistence(entries) {
  const existing = entries.filter((entry) => existsSync(path.join(__dirname, entry.in)));
  const missing = entries.filter((entry) => !existing.includes(entry));
  return { existing, missing };
}

const { existing: existingEntries, missing: missingEntries } = partitionByExistence(plannedEntries);
const { existing: existingHookEntries, missing: missingHookEntries } = partitionByExistence(hookEntries);
const { existing: existingScriptEntries, missing: missingScriptEntries } = partitionByExistence(scriptEntries);

const allMissing = [...missingEntries, ...missingHookEntries, ...missingScriptEntries];
if (allMissing.length > 0) {
  console.warn(
    `[esbuild.config.mjs] Skipping ${allMissing.length} entry point(s) not yet created (expected during Phase 1 scaffold):`
  );
  for (const entry of allMissing) {
    console.warn(`  - ${entry.in}`);
  }
}

if (existingEntries.length === 0 && existingHookEntries.length === 0 && existingScriptEntries.length === 0) {
  console.warn(
    "[esbuild.config.mjs] No entry points exist yet — nothing to build. This is expected until Phase 2+ lands source files."
  );
  process.exit(0);
}

if (existingEntries.length > 0) {
  await esbuild.build({
    entryPoints: existingEntries.map((entry) => ({
      in: path.join(__dirname, entry.in),
      out: entry.out.replace(/^plugin\/dist\//, ""),
    })),
    outdir: path.join(__dirname, "plugin/dist"),
    bundle: true,
    platform: "node",
    target: "es2022",
    format: "esm",
    banner: esmRequireBanner,
    sourcemap: true,
    logLevel: "info",
    // See `nativeExternals`'s own comment above: only src/optimizer/server.ts
    // actually imports these, but marking them external is a no-op for the
    // other entries in this same build call.
    external: nativeExternals,
  });
}

if (existingHookEntries.length > 0) {
  await esbuild.build({
    entryPoints: existingHookEntries.map((entry) => ({
      in: path.join(__dirname, entry.in),
      out: entry.out,
    })),
    outdir: path.join(__dirname, "plugin/hooks"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    target: "es2022",
    format: "esm",
    banner: esmRequireBanner,
    sourcemap: true,
    logLevel: "info",
  });
}

if (existingScriptEntries.length > 0) {
  await esbuild.build({
    entryPoints: existingScriptEntries.map((entry) => ({
      in: path.join(__dirname, entry.in),
      out: entry.out,
    })),
    outdir: path.join(__dirname, "plugin/scripts"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    target: "es2022",
    format: "esm",
    banner: esmRequireBanner,
    sourcemap: true,
    logLevel: "info",
  });
}
