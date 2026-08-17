// Module 4: session checkpoints (`.optiflow/checkpoints/<id>.json`).
//
// A checkpoint is a snapshot of "what to tell a fresh session" taken either
// automatically (the `PreCompact`/`SessionEnd` hooks, via
// `src/handoff/precompact-hook.ts` / `sessionend-hook.ts`) or on demand (the
// `/optiflow:checkpoint` command / `optiflow checkpoint` CLI). The two paths
// populate genuinely different subsets of the shape below — see the field
// notes on `Checkpoint` — and this module is honest about that split rather
// than pretending a hook payload can supply free-text decisions/next steps.
//
// FIELD PROVENANCE (per the plan's Phase 7 brief — "be honest about what
// data is actually available"):
//   - sessionId, cwd:       from the hook payload (`session_id`/`cwd`) when
//                           auto-triggered, or from the CLI's own
//                           process.cwd()/a generated id when manual.
//   - timestamp:            always `Date.now()` at checkpoint time.
//   - gitBranch, gitHead:   always auto-derived via real `git` calls
//                           (`getGitInfo` below) — genuinely available in
//                           both the hook and manual paths, since both know
//                           `cwd`. `null` (not thrown) when git is absent,
//                           `cwd` isn't a repo, or the repo has no commits
//                           yet (a fresh `git init` has no HEAD to resolve).
//   - model:                present only when the hook payload happens to
//                           carry a `model` field. This is NOT a documented
//                           PreCompact/SessionEnd field (see module header
//                           of precompact-hook.ts) — treat as usually null.
//   - openFiles, decisions,
//     nextSteps:            NEVER auto-derivable from a hook payload alone
//                           (Claude Code doesn't hand a hook the model's
//                           open-file list or reasoning). The auto-hooks
//                           always pass `[]` for all three. Only the manual
//                           `/optiflow:checkpoint [notes]` command / `optiflow
//                           checkpoint [notes] --next-step ... --open-file
//                           ...` CLI populate them, from user-supplied text.
//   - tokenOptimizerStateRef: a REFERENCE to token-optimizer-mcp's own
//                           session-state artifact, never a copy of its
//                           content — see `resolveTokenOptimizerStateRef`.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { runCommand } from "../chop/win-spawn.js";
import { findProjectRoot } from "../core/paths.js";
import { loadConfig } from "../config/load.js";

export interface GitInfo {
  branch: string | null;
  head: string | null;
}

/**
 * Real `git` calls (via `src/chop/win-spawn.ts`'s cross-platform-safe
 * `runCommand`, reused rather than reimplemented — git.exe always takes its
 * `shell:false` fast path there, so this gets Windows-safety for free).
 * Uses `git -C <cwd>` rather than changing `process.cwd()`, so this is
 * trivially testable against a real sandboxed repo without touching the
 * calling process's own working directory.
 *
 * Never throws: absent `git`, a `cwd` that isn't a repo, and — the case
 * that's easy to miss — a freshly-`git init`'d repo with no commits yet
 * (which has no HEAD to resolve, so `rev-parse HEAD` exits non-zero) all
 * resolve to `{ branch: null, head: null }` rather than a thrown error.
 */
export function getGitInfo(cwd: string): GitInfo {
  const branchResult = runCommand("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
  const headResult = runCommand("git", ["-C", cwd, "rev-parse", "HEAD"]);

  const branch =
    branchResult.status === 0 && !branchResult.spawnError
      ? branchResult.stdout.trim() || null
      : null;
  const head =
    headResult.status === 0 && !headResult.spawnError ? headResult.stdout.trim() || null : null;

  return { branch, head };
}

export interface TokenOptimizerStateRef {
  /** Absolute path to token-optimizer-mcp's own persisted session-state file. */
  file: string;
  /** The key this session is (or would be) filed under inside `file`. */
  sessionId: string;
  /** Whether `file` actually existed on disk at checkpoint time. */
  exists: boolean;
}

/**
 * Resolves a REFERENCE to token-optimizer-mcp's own session state — never a
 * re-serialized copy of it (plan Module 4 / this phase's brief). Points at
 * `~/.token-optimizer/sessions.json.gz`, which is the file
 * `vendor/token-optimizer-mcp/src/server/index.ts` (`persistencePath:
 * path.join(os.homedir(), '.token-optimizer', 'sessions.json')`, gzipped by
 * `SessionManager`'s `saveGzippedFile`) actually persists to on disk, keyed
 * internally by `sessionId` (`vendor/token-optimizer-mcp/src/core/
 * session-manager.ts`). This is the MCP server's own durable session store —
 * distinct from (and NOT the same file as) the plugin hooks' own ephemeral
 * per-process state under `TOKEN_OPTIMIZER_STATE_DIR`/`os.tmpdir()`
 * (`vendor/token-optimizer-mcp/plugin/hooks/lib/policy.mjs`'s `stateRoot()`),
 * which was confirmed absent on this machine and would be a reference to
 * nothing.
 *
 * `exists` is computed at checkpoint time so `restore.ts` can render an
 * honest "this reference does/doesn't currently resolve" note rather than
 * silently asserting resolvability it hasn't checked.
 */
export function resolveTokenOptimizerStateRef(
  sessionId: string,
  options: { tokenOptimizerHome?: string } = {}
): TokenOptimizerStateRef {
  const home = options.tokenOptimizerHome ?? homedir();
  const file = path.join(home, ".token-optimizer", "sessions.json.gz");
  return { file, sessionId, exists: existsSync(file) };
}

/** Matches `type ModelInfo` shapes optimistically found on a hook payload's `model` field — see module header on why this is usually absent. */
export type ModelLike = string | { id?: string | null; display_name?: string | null; slug?: string | null } | null | undefined;

/** Normalizes whatever shape `model` happens to arrive in to a plain string or `null`. Never throws. */
export function normalizeModel(model: ModelLike): string | null {
  if (typeof model === "string") return model.trim() || null;
  if (model && typeof model === "object") {
    const name = model.display_name ?? model.id ?? model.slug;
    return typeof name === "string" && name.trim() ? name : null;
  }
  return null;
}

export interface Checkpoint {
  sessionId: string;
  timestamp: number;
  cwd: string;
  gitBranch: string | null;
  gitHead: string | null;
  model: string | null;
  openFiles: string[];
  decisions: string[];
  nextSteps: string[];
  tokenOptimizerStateRef: TokenOptimizerStateRef;
}

export interface BuildCheckpointInput {
  sessionId: string;
  cwd: string;
  model?: ModelLike;
  openFiles?: string[];
  decisions?: string[];
  nextSteps?: string[];
}

export interface BuildCheckpointOptions {
  /** Override "now" (tests only; defaults to `Date.now()`). */
  now?: Date;
  /** Override for token-optimizer's home dir lookup (tests only). */
  tokenOptimizerHome?: string;
  /** Inject already-resolved git info (tests only) instead of shelling out. */
  gitInfo?: GitInfo;
}

/**
 * Pure(-ish) core: combines the input + already-resolvable-without-user-text
 * fields into a full `Checkpoint`. `gitInfo`/`tokenOptimizerHome` are
 * injectable so unit tests can verify the field-merging logic without
 * spawning real `git` or touching a real home directory — the real `git`
 * behavior itself is covered separately by `getGitInfo`'s own sandbox tests.
 */
export function buildCheckpoint(
  input: BuildCheckpointInput,
  options: BuildCheckpointOptions = {}
): Checkpoint {
  const timestamp = (options.now ?? new Date()).getTime();
  const gitInfo = options.gitInfo ?? getGitInfo(input.cwd);

  return {
    sessionId: input.sessionId,
    timestamp,
    cwd: input.cwd,
    gitBranch: gitInfo.branch,
    gitHead: gitInfo.head,
    model: normalizeModel(input.model),
    openFiles: input.openFiles ?? [],
    decisions: input.decisions ?? [],
    nextSteps: input.nextSteps ?? [],
    tokenOptimizerStateRef: resolveTokenOptimizerStateRef(input.sessionId, {
      tokenOptimizerHome: options.tokenOptimizerHome,
    }),
  };
}

/**
 * The on-disk id/filename stem for a checkpoint: `<sanitized-sessionId>-
 * <timestamp>`. Sanitization mirrors the same defensive pattern vendored
 * token-optimizer-mcp uses for its own session-keyed filenames
 * (`vendor/token-optimizer-mcp/plugin/hooks/lib/policy.mjs`'s `statePath`) —
 * session ids come from the harness and are uuid-shaped, but they land in a
 * file path, so anything that could traverse a path is stripped rather than
 * trusted. The timestamp suffix means multiple checkpoints per session never
 * collide, and lets `restore.ts` pick "most recent" without reading mtimes.
 */
export function checkpointId(checkpoint: Pick<Checkpoint, "sessionId" | "timestamp">): string {
  const safe = String(checkpoint.sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "");
  return `${safe || "unknown"}-${checkpoint.timestamp}`;
}

export interface ResolveCheckpointDirOptions {
  cwd?: string;
  home?: string;
  /** Bypasses config resolution entirely (tests only). */
  checkpointDirOverride?: string;
}

/**
 * Resolves the directory checkpoints are written to/read from:
 * `handoff.checkpointDir` (default `.optiflow/checkpoints`, see
 * `src/config/defaults.ts`) resolved against the project root found from
 * `cwd` — unless it's already absolute, in which case it passes through
 * unchanged (a project may legitimately want checkpoints outside the repo).
 */
export function resolveCheckpointDir(options: ResolveCheckpointDirOptions = {}): string {
  const checkpointDir =
    options.checkpointDirOverride ??
    loadConfig({ cwd: options.cwd, home: options.home }).config.handoff.checkpointDir;

  if (path.isAbsolute(checkpointDir)) return checkpointDir;

  const projectRoot = findProjectRoot(options.cwd ?? process.cwd());
  return path.join(projectRoot, checkpointDir);
}

export interface WriteCheckpointResult {
  filePath: string;
  id: string;
}

/** Writes `checkpoint` to `<resolved checkpoint dir>/<id>.json`, creating the directory if needed. */
export function writeCheckpoint(
  checkpoint: Checkpoint,
  options: ResolveCheckpointDirOptions = {}
): WriteCheckpointResult {
  const dir = resolveCheckpointDir(options);
  mkdirSync(dir, { recursive: true });
  const id = checkpointId(checkpoint);
  const filePath = path.join(dir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), "utf8");
  return { filePath, id };
}

export interface CheckpointFileEntry {
  filePath: string;
  /** The filename stem (no `.json`) — equals `checkpointId()`'s output for a well-formed file. */
  id: string;
  timestamp: number;
}

/**
 * Lists every well-formed checkpoint file directly inside `dir` (no
 * recursion), pairing each with its filename stem and parsed in-file
 * `timestamp`. This is the SINGLE shared listing implementation both
 * `pruneCheckpoints` (below) and `restore.ts`'s `findLatestCheckpoint`/
 * `findCheckpointById` build on — `restore.ts` imports this rather than
 * keeping its own `readdirSync` loop, so there is exactly one place that
 * decides what counts as "a checkpoint" for listing purposes.
 *
 * A `.json` file that doesn't parse, isn't an object, or is missing
 * `sessionId`/`timestamp` is silently skipped — NOT deleted, NOT treated as
 * an error. This means a corrupted checkpoint file is invisible to
 * `pruneCheckpoints` and will never be cleaned up automatically: "ignore
 * forever" is the safe failure mode for a file this function can't
 * understand, deliberately not "delete anything unrecognized in the
 * directory" (which risks deleting something a future format version, or an
 * unrelated file a user placed there, actually needed).
 */
export function listCheckpointFiles(dir: string): CheckpointFileEntry[] {
  try {
    if (!existsSync(dir)) return [];
    const entries: CheckpointFileEntry[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const filePath = path.join(dir, name);
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8"));
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as Record<string, unknown>).sessionId === "string" &&
          typeof (parsed as Record<string, unknown>).timestamp === "number"
        ) {
          entries.push({
            filePath,
            id: name.slice(0, -".json".length),
            timestamp: (parsed as Record<string, unknown>).timestamp as number,
          });
        }
      } catch {
        // Unparseable/malformed file — skip it, see module doc above.
        continue;
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export interface PruneCheckpointsOptions {
  /** Number of newest checkpoints to keep; `<= 0` disables pruning entirely (see schema.ts on why `keep: 0` means "unlimited", not "invalid"). */
  keep: number;
}

/**
 * Deletes checkpoint files in `dir` beyond the newest `keep`, ordered by
 * in-file `timestamp` — deliberately NEVER by filename/`checkpointId()`
 * order (that stem is `<sanitized-sessionId>-<timestamp>`, so lexicographic
 * filename sort is NOT chronological once two different session ids are
 * involved: `"abc-1700000000000"` sorts before `"zzz-1600000000000"` despite
 * being newer) and NEVER by filesystem mtime (a copy/touch/clone/checkout
 * can perturb mtime independently of when the checkpoint was actually
 * taken).
 *
 * Never throws: a failed individual `unlinkSync` (permissions, concurrent
 * deletion, etc.) is caught and skipped rather than aborting the rest of
 * the prune or propagating to the caller — same fire-and-forget-bookkeeping
 * contract `src/core/logger.ts` documents for its own writes.
 */
export function pruneCheckpoints(dir: string, options: PruneCheckpointsOptions): void {
  if (!Number.isFinite(options.keep) || options.keep <= 0) return;
  try {
    const entries = listCheckpointFiles(dir);
    if (entries.length <= options.keep) return;

    entries.sort((a, b) => b.timestamp - a.timestamp);
    const toDelete = entries.slice(options.keep);
    for (const entry of toDelete) {
      try {
        unlinkSync(entry.filePath);
      } catch {
        // A failed delete must never break the caller — best-effort only.
      }
    }
  } catch {
    // Pruning must never break the caller.
  }
}

export interface CreateCheckpointOptions extends BuildCheckpointOptions, ResolveCheckpointDirOptions {
  /** Override `handoff.keep` (tests only); defaults to the resolved config's `handoff.keep`. */
  keepOverride?: number;
}

/**
 * The convenience entry point both the manual CLI/command and (via a
 * `handoff.enabled` check the caller performs first — see
 * `precompact-hook.ts`/`sessionend-hook.ts`) the auto-hooks use: build,
 * write, then prune old checkpoints beyond `handoff.keep`, in one call.
 * Pruning failures never propagate — see `pruneCheckpoints`.
 */
export function createCheckpoint(
  input: BuildCheckpointInput,
  options: CreateCheckpointOptions = {}
): { checkpoint: Checkpoint; write: WriteCheckpointResult } {
  const checkpoint = buildCheckpoint(input, options);
  const write = writeCheckpoint(checkpoint, options);

  try {
    const keep =
      options.keepOverride ?? loadConfig({ cwd: options.cwd, home: options.home }).config.handoff.keep;
    pruneCheckpoints(path.dirname(write.filePath), { keep });
  } catch {
    // Pruning must never break checkpoint creation itself.
  }

  return { checkpoint, write };
}
