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
