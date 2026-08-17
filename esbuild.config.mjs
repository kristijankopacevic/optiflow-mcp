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

/** @type {{ in: string; out: string }[]} */
const plannedEntries = [
  { in: "src/cli/index.ts", out: "plugin/dist/cli/index" },
  { in: "src/chop/pretooluse.ts", out: "plugin/dist/chop/pretooluse" },
  { in: "src/chop/posttooluse-mcp.ts", out: "plugin/dist/chop/posttooluse-mcp" },
  { in: "src/statusline/render.ts", out: "plugin/dist/statusline/render" },
  { in: "src/handoff/checkpoint.ts", out: "plugin/dist/handoff/checkpoint" },
  { in: "src/handoff/restore.ts", out: "plugin/dist/handoff/restore" },
  { in: "src/transcript/render.ts", out: "plugin/dist/transcript/render" },
];

const existingEntries = plannedEntries.filter((entry) =>
  existsSync(path.join(__dirname, entry.in))
);
const missingEntries = plannedEntries.filter(
  (entry) => !existingEntries.includes(entry)
);

if (missingEntries.length > 0) {
  console.warn(
    `[esbuild.config.mjs] Skipping ${missingEntries.length} entry point(s) not yet created (expected during Phase 1 scaffold):`
  );
  for (const entry of missingEntries) {
    console.warn(`  - ${entry.in}`);
  }
}

if (existingEntries.length === 0) {
  console.warn(
    "[esbuild.config.mjs] No entry points exist yet — nothing to build. This is expected until Phase 2+ lands source files."
  );
  process.exit(0);
}

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
