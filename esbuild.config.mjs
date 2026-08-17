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
];

function partitionByExistence(entries) {
  const existing = entries.filter((entry) => existsSync(path.join(__dirname, entry.in)));
  const missing = entries.filter((entry) => !existing.includes(entry));
  return { existing, missing };
}

const { existing: existingEntries, missing: missingEntries } = partitionByExistence(plannedEntries);
const { existing: existingHookEntries, missing: missingHookEntries } = partitionByExistence(hookEntries);

const allMissing = [...missingEntries, ...missingHookEntries];
if (allMissing.length > 0) {
  console.warn(
    `[esbuild.config.mjs] Skipping ${allMissing.length} entry point(s) not yet created (expected during Phase 1 scaffold):`
  );
  for (const entry of allMissing) {
    console.warn(`  - ${entry.in}`);
  }
}

if (existingEntries.length === 0 && existingHookEntries.length === 0) {
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
    sourcemap: true,
    logLevel: "info",
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
    sourcemap: true,
    logLevel: "info",
  });
}
