// Config resolution: project ./optiflow.config.json merged over user-global
// ~/.optiflow/config.json merged over defaults, project wins key-by-key.
// Merging is shallow *per top-level section* (e.g. `{...defaults.chop,
// ...project.chop}`), not a single shallow merge of the whole object — a
// blanket top-level merge would let a project setting one `chop` key
// silently drop `chop.enabled: false` by omitting the rest of that section.
//
// Validates the merged result through the zod schema. On validation
// failure, falls back to defaults and prints a clear warning to stderr —
// this must never throw, because hooks must fail open when config is
// malformed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import { OptiflowConfigSchema, type OptiflowConfig } from "./schema.js";
import { findProjectRoot, getOptiflowHome } from "../core/paths.js";

const TOP_LEVEL_SECTIONS = [
  "chop",
  "toon",
  "statusline",
  "handoff",
  "report",
  "telemetry",
  // kompress/smartCrusher (v2 Phase 5c) were added to schema.ts/defaults.ts
  // but not here — without this, a project/user config's "kompress"/
  // "smartCrusher" section was silently dropped before it ever reached
  // zod (mergeLayers only ever copies keys listed here), so neither was
  // actually overridable despite the schema/defaults supporting it.
  "kompress",
  "smartCrusher",
] as const;

type RawConfig = Record<string, unknown>;

export interface LoadConfigOptions {
  /** Directory to start the project-root search from. Defaults to cwd. */
  cwd?: string;
  /** Override for the user-global ~/.optiflow directory (tests only). */
  home?: string;
}

export interface LoadedConfig {
  config: OptiflowConfig;
  sources: {
    userGlobal: string | null;
    project: string | null;
  };
  /** True if validation failed and DEFAULT_CONFIG was used instead. */
  usedFallback: boolean;
  /** Human-readable validation issues, present only when usedFallback. */
  fallbackReason?: string;
}

function readJsonObject(filePath: string): RawConfig | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RawConfig;
    }
    return null;
  } catch {
    return null;
  }
}

function mergeSection(base: unknown, override: unknown): unknown {
  if (
    override &&
    typeof override === "object" &&
    !Array.isArray(override) &&
    base &&
    typeof base === "object" &&
    !Array.isArray(base)
  ) {
    return { ...(base as object), ...(override as object) };
  }
  // If override isn't a plain object (missing, wrong type, etc.), keep base
  // as-is; the zod pass afterward will still catch genuinely invalid shapes.
  return override === undefined ? base : override;
}

function mergeLayers(...layers: Array<RawConfig | null>): RawConfig {
  const merged: RawConfig = {};
  for (const section of TOP_LEVEL_SECTIONS) {
    let value: unknown = (DEFAULT_CONFIG as unknown as RawConfig)[section];
    for (const layer of layers) {
      if (layer && Object.prototype.hasOwnProperty.call(layer, section)) {
        value = mergeSection(value, layer[section]);
      }
    }
    merged[section] = value;
  }
  return merged;
}

/**
 * Resolves and validates optiflow's config. Layer precedence (later wins,
 * merged per top-level section): defaults -> user-global -> project.
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? getOptiflowHome();

  const userGlobalPath = path.join(home, "config.json");
  const projectRoot = findProjectRoot(cwd);
  const projectPath = path.join(projectRoot, "optiflow.config.json");

  const userGlobalRaw = readJsonObject(userGlobalPath);
  const projectRaw = readJsonObject(projectPath);

  const merged = mergeLayers(userGlobalRaw, projectRaw);
  const sources = {
    userGlobal: userGlobalRaw ? userGlobalPath : null,
    project: projectRaw ? projectPath : null,
  };

  const result = OptiflowConfigSchema.safeParse(merged);
  if (result.success) {
    return { config: result.data, sources, usedFallback: false };
  }

  const issues = result.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  process.stderr.write(
    `[optiflow] Warning: optiflow.config.json (or ~/.optiflow/config.json) failed validation; falling back to defaults.\n${issues}\n`
  );

  return {
    config: OptiflowConfigSchema.parse(DEFAULT_CONFIG),
    sources,
    usedFallback: true,
    fallbackReason: issues,
  };
}
