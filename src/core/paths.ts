// Path resolution for optiflow's user-global directory, project root, and
// project-local directory. Deliberately depends only on Node builtins (see
// esbuild.config.mjs / statusline notes: this module sits on the statusline
// hot path in later phases, so no zod/commander/@toon-format imports here).

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Resolves `~/.optiflow`, the user-global directory for config, logs, and
 * the ledger. Honors `OPTIFLOW_HOME` as an override so tests (and anyone
 * sandboxing optiflow) never have to touch the real home directory.
 */
export function getOptiflowHome(): string {
  const override = process.env.OPTIFLOW_HOME;
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return path.join(homedir(), ".optiflow");
}

/**
 * Walks up from `startDir` (default: cwd) looking for a project root marker:
 * a `.git` entry (directory for a normal repo, or a *file* for a git
 * submodule/worktree — hence `existsSync`, not a directory-only check) or an
 * `optiflow.config.json`. Falls back to `startDir` itself if no marker is
 * found before reaching the filesystem root.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (
      existsSync(path.join(dir, ".git")) ||
      existsSync(path.join(dir, "optiflow.config.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding a marker.
      return path.resolve(startDir);
    }
    dir = parent;
  }
}

/**
 * Resolves the project-local `.optiflow/` directory (checkpoints, logs)
 * relative to a project root. Callers that already know the project root
 * should pass it explicitly to avoid a redundant filesystem walk.
 */
export function getProjectLocalDir(
  projectRoot: string = findProjectRoot()
): string {
  return path.join(projectRoot, ".optiflow");
}
