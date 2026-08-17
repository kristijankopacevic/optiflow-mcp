// Module 2: locating transcript files under `~/.claude/projects/`.
//
// Directory-naming convention below was CONFIRMED against real directories
// on this machine (not guessed): `~/.claude/projects/` contains one
// directory per project "slug", and the slug for a session launched from
// `C:\Users\Kristijan` is literally `C--Users-Kristijan` — i.e. every `:`
// and `\` (or `/` on POSIX) in the absolute launch directory is replaced
// with `-`, and every other character (including a directory name's own
// `-`) is left alone. Verified precisely: `"C:\\Users\\Kristijan"` sanitizes
// to `"C--Users-Kristijan"` byte-for-byte via `slugifyPath` below, and a
// real session's own transcript (grepped for its `cwd` field) was found
// filed under exactly that directory.
//
// IMPORTANT caveat (confirmed by the same inspection, don't over-claim):
// the slug is derived from the session's ORIGINAL LAUNCH directory, not
// from `cwd`-at-any-given-moment — a session's `cwd` field changes line to
// line as the user/agent `cd`s around, but every line in a given session's
// `.jsonl` file lives under the SAME slug directory, matching the launch
// directory. That means `discoverCurrentProjectFiles` (which only has
// `process.cwd()` at CLI-invocation time to go on, not the original launch
// directory of whatever Claude Code session might be reading this) is a
// best-effort approximation, not a guarantee — a project's transcripts will
// only be found this way if the CLI is invoked from the same directory
// Claude Code itself was launched from. `--session <id>` (exact match,
// slug-independent) and `--all` are the reliable paths; `--session` is what
// this module's own real-data verification run uses for exactly this
// reason.
//
// Also confirmed: each per-session subdirectory alongside a session's
// `<sessionId>.jsonl` file (e.g. `<slug>/<sessionId>/tool-results/`) holds
// unrelated artifacts, not additional transcript data — discovery only
// globs `*.jsonl` files directly inside a slug directory, never recursing
// into those subdirectories.
//
// Every function here handles "the directory doesn't exist at all"
// (fresh machine, never run Claude Code) as a normal case — an empty
// array, never a thrown error.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface DiscoverOptions {
  /** Override `~/.claude/projects` (tests only). */
  projectsDir?: string;
}

/** Resolves `~/.claude/projects` (or the test override). */
export function getClaudeProjectsDir(options: DiscoverOptions = {}): string {
  if (options.projectsDir) return path.resolve(options.projectsDir);
  return path.join(homedir(), ".claude", "projects");
}

/**
 * Sanitizes an absolute directory path into the slug Claude Code uses for
 * its `~/.claude/projects/<slug>` directories: every `:`, `\`, and `/` is
 * replaced with `-`; everything else is left as-is. Confirmed against real
 * data for the `:`/`\` case (see module header); `.`/`_`/space handling is
 * UNVERIFIED (no local sample path contains them) and intentionally not
 * guessed beyond this narrow, confirmed rule.
 */
export function slugifyPath(absolutePath: string): string {
  // Each `:`/`\`/`/` becomes its own `-` (NOT collapsed when adjacent) —
  // confirmed against real data: "C:\Users\Kristijan" has two adjacent
  // separator characters (`:` then `\`) and sanitizes to "C--Users-..."
  // (two hyphens), not "C-Users-..." (one).
  return absolutePath.replace(/[\\/:]/g, "-");
}

function listJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Best-effort discovery of the current project's transcript files, derived
 * from `cwd` (default `process.cwd()`) the same way Claude Code derives its
 * slug from a session's launch directory — see the important caveat in the
 * module header about why this can legitimately find nothing even when
 * transcripts for "this project" exist (they were filed under the slug of
 * wherever Claude Code was originally launched from, which may differ from
 * the CLI's own cwd). Returns `[]`, never throws, if the projects root or
 * the derived slug directory doesn't exist.
 */
export function discoverCurrentProjectFiles(
  cwd: string = process.cwd(),
  options: DiscoverOptions = {}
): string[] {
  const projectsDir = getClaudeProjectsDir(options);
  const slug = slugifyPath(path.resolve(cwd));
  return listJsonlFiles(path.join(projectsDir, slug));
}

/**
 * Finds the transcript file for an exact `sessionId`, regardless of which
 * project slug it lives under (`~/.claude/projects/<any-slug>/<sessionId>.jsonl`).
 * Slug-independent by design — see module header on why this is the
 * reliable lookup path when the exact project slug can't be derived with
 * confidence. Returns `[]` (never throws) if the projects root doesn't
 * exist or no matching file is found.
 */
export function discoverBySessionId(sessionId: string, options: DiscoverOptions = {}): string[] {
  const projectsDir = getClaudeProjectsDir(options);
  if (!existsSync(projectsDir) || sessionId.trim().length === 0) return [];

  const target = `${sessionId}.jsonl`;
  const matches: string[] = [];
  try {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(projectsDir, entry.name, target);
      if (existsSync(candidate)) matches.push(candidate);
    }
  } catch {
    return [];
  }
  return matches.sort();
}

/**
 * All transcript files across every project slug directory
 * (`~/.claude/projects/<any-slug>/<any-session>.jsonl`). Returns `[]` (never throws) on a fresh
 * machine with no `~/.claude/projects` directory at all.
 */
export function discoverAllProjectFiles(options: DiscoverOptions = {}): string[] {
  const projectsDir = getClaudeProjectsDir(options);
  if (!existsSync(projectsDir)) return [];

  const files: string[] = [];
  try {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      files.push(...listJsonlFiles(path.join(projectsDir, entry.name)));
    }
  } catch {
    return [];
  }
  return files.sort();
}
