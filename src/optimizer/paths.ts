// Path resolution for the merged optimizer tools (ported from
// vendor/token-optimizer-mcp, MIT-licensed — see THIRD_PARTY_LICENSES.md).
//
// Every ported module under src/optimizer/** that used to resolve one of
// token-optimizer-mcp's own `~/.token-optimizer*` / `~/.hypercontext*` paths
// (config.json, sessions.json, the cache dir, analytics.db, projects.jsonl,
// the wiki dir, file-backup's BACKUP_ROOT) must call one of the helpers
// below instead of `os.homedir()` directly. One path convention
// (`~/.optiflow/optimizer/**`, nested under optiflow's own
// `getOptiflowHome()`), not two competing ones.
//
// Deliberately depends only on Node builtins plus src/core/paths.ts's
// `getOptiflowHome()` — no zod/commander/@toon-format imports here, matching
// that module's own "no heavy deps" convention since this can sit on a hot
// path (every optimizer tool call resolves at least one of these).

import path from "node:path";
import { getOptiflowHome } from "../core/paths.js";

/** `~/.optiflow/optimizer` — the optimizer's own subtree of optiflow's home. */
export function getOptimizerHome(): string {
  return path.join(getOptiflowHome(), "optimizer");
}

/** Replaces token-optimizer-mcp's `~/.token-optimizer/config.json`. */
export function getOptimizerConfigPath(): string {
  return path.join(getOptimizerHome(), "config.json");
}

/**
 * Replaces token-optimizer-mcp's `~/.token-optimizer-cache/` directory.
 * Callers that need the SQLite file itself should use
 * `getOptimizerCacheDbPath()`, not this directory — `CacheEngine`'s
 * constructor treats a path that doesn't exist yet as a *file* path, not a
 * directory to create, so handing it a bare directory on first run silently
 * misplaces the database one level up.
 */
export function getOptimizerCacheDir(): string {
  return path.join(getOptimizerHome(), "cache");
}

/** The actual SQLite database file inside `getOptimizerCacheDir()`. */
export function getOptimizerCacheDbPath(): string {
  return path.join(getOptimizerCacheDir(), "cache.db");
}

/** Replaces token-optimizer-mcp's `~/.token-optimizer-mcp/analytics.db`. */
export function getOptimizerAnalyticsDbPath(): string {
  return path.join(getOptimizerHome(), "analytics.db");
}

/** Replaces token-optimizer-mcp's `~/.token-optimizer/sessions.json`. */
export function getOptimizerSessionsPath(): string {
  return path.join(getOptimizerHome(), "sessions.json");
}

/** Replaces token-optimizer-mcp's `~/.token-optimizer/wiki/`. */
export function getOptimizerWikiDir(): string {
  return path.join(getOptimizerHome(), "wiki");
}

/** Replaces token-optimizer-mcp's `~/.token-optimizer/projects.jsonl`. */
export function getOptimizerProjectsJsonlPath(): string {
  return path.join(getOptimizerHome(), "projects.jsonl");
}

/** Replaces token-optimizer-mcp's `~/.token-optimizer/backups` (file-backup.ts's `BACKUP_ROOT`). */
export function getOptimizerBackupsDir(): string {
  return path.join(getOptimizerHome(), "backups");
}

/**
 * Replaces `advanced-caching/cache-benchmark.ts`'s own hardcoded
 * `join(homedir(), '.hypercontext', 'reports')` default output directory for
 * its `report` operation (a genuinely new persistence need this category
 * introduces -- no earlier checkpoint's tool wrote a report file to a
 * default, caller-independent location). Unlike every other helper in this
 * file, vendor's own default path here was never `mkdirSync`-created before
 * the `writeFileSync` call that uses it -- a real, pre-existing vendor gap
 * that only surfaces on a clean machine with no prior `.hypercontext`
 * directory. Callers using this default path (as opposed to an
 * explicit `outputPath` option) must create this directory first; this
 * function only resolves the path, matching every other helper's "no I/O"
 * convention here.
 */
export function getOptimizerReportsDir(): string {
  return path.join(getOptimizerHome(), "reports");
}

/**
 * Replaces `analytics/optimization-storage.ts`'s own hardcoded
 * `join(homedir(), '.token-optimizer', 'optimization.db')` default --
 * `getDefaultOptimizationDbPath()`'s real vendor default before this
 * reconciliation. A separate on-disk SQLite database from
 * `getOptimizerAnalyticsDbPath()` (that one stores per-call token-savings
 * *events*; this one is a content-addressed original-text -> optimized-text
 * cache keyed by hash, a different schema/purpose vendor itself kept as a
 * separate file), so it earns its own helper rather than reusing one.
 */
export function getOptimizerOptimizationDbPath(): string {
  return path.join(getOptimizerHome(), "optimization.db");
}

/**
 * Replaces `analytics/native-provider-usage.ts`'s own hardcoded
 * `path.join(home, '.token-optimizer', 'unrooted')` -- the sibling of
 * `getOptimizerWikiDir()` for graph data belonging to a project with no
 * detected git root. Only used by that file's own default-home scan path
 * (a custom `homeDirectory` override, used for test fixtures, still resolves
 * relative to the literal passed-in home -- see that file's own comment).
 */
export function getOptimizerUnrootedDir(): string {
  return path.join(getOptimizerHome(), "unrooted");
}
