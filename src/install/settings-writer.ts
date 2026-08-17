// Safe, atomic read-modify-write helper for a Claude Code `settings.json`
// file (user-level `~/.claude/settings.json` by default, or a project-level
// path). Backing store for `optiflow install --statusline` / `optiflow
// uninstall` (plan Risk R5: "the installer must back up to
// `settings.json.optiflow-backup-<ts>`, write atomically (temp + rename),
// and `optiflow uninstall` must restore").
//
// Generic enough for a future key to reuse (`writeSettingsKey`/
// `removeSettingsKey`), but only `statusLine` is actually wired today —
// per the task brief, no other key is touched.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Namespace for real, restorable backups — the only one `findLatestBackup` matches. */
const BACKUP_MARKER = ".optiflow-backup-";
/**
 * Namespace for `restoreSettingsBackup`'s own pre-restore snapshot.
 * Deliberately distinct from `BACKUP_MARKER` — see `backupSettingsFile`'s
 * doc comment for why conflating the two would make `uninstall` reverse
 * itself when run twice.
 */
const PRERESTORE_MARKER = ".optiflow-prerestore-";

// ---------------------------------------------------------------------------
// Low-level read/backup/atomic-write primitives.
// ---------------------------------------------------------------------------

/**
 * Resolves the default Claude Code user-global settings path
 * (`<home>/.claude/settings.json`). `home` defaults to `os.homedir()`;
 * callers/tests can override it to avoid ever touching the real file.
 */
export function resolveDefaultSettingsPath(home: string = homedir()): string {
  return path.join(home, ".claude", "settings.json");
}

/**
 * Reads `settingsPath` as a JSON object, treating a missing or
 * whitespace-only file as `{}` (nothing to lose). Malformed JSON, or a
 * top-level value that isn't a plain object (an array or scalar), throws —
 * unlike a read-only probe (see `detect.ts`'s deliberate fail-open
 * behavior), a *writer* must never silently discard/overwrite a file it
 * couldn't actually understand.
 */
export function readSettingsFile(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8");
  if (raw.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `optiflow: refusing to write ${settingsPath} — the existing file is not valid JSON ` +
        `(${(err as Error).message}). Fix or remove it by hand before retrying.`
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `optiflow: refusing to write ${settingsPath} — its top-level JSON value is not an object.`
    );
  }

  return parsed as Record<string, unknown>;
}

/**
 * Copies `settingsPath` to `<settingsPath><marker><epochMs>` if the file
 * exists, returning the backup path (or `null` if there was nothing to
 * back up). Epoch milliseconds, not an ISO timestamp: `:` is illegal in a
 * Windows filename, and a fixed-width numeric suffix also sorts correctly
 * as a plain string (same reasoning `docs/modules.md` documents for why
 * checkpoint pruning orders by in-file timestamp rather than filename).
 *
 * `marker` defaults to the real, restorable backup namespace
 * (`BACKUP_MARKER`) — `restoreSettingsBackup` passes `PRERESTORE_MARKER`
 * instead for its own "snapshot of what we're about to overwrite" copy, so
 * that snapshot can never be picked up by `findLatestBackup` (which only
 * matches `BACKUP_MARKER`) and accidentally restored right back over itself
 * on a second `uninstall` run.
 */
export function backupSettingsFile(
  settingsPath: string,
  nowMs: number,
  marker: string = BACKUP_MARKER
): string | null {
  if (!existsSync(settingsPath)) return null;
  const backupPath = `${settingsPath}${marker}${nowMs}`;
  copyFileSync(settingsPath, backupPath);
  return backupPath;
}

/**
 * Writes `contents` to `targetPath` atomically: a temp file in the same
 * directory, then a rename over the target. Never writes in place — a
 * crash mid-write must never leave a corrupted/truncated settings.json. On
 * any failure, the temp file is cleaned up and the original error rethrown,
 * leaving the target untouched.
 */
export function atomicWriteFile(targetPath: string, contents: string): void {
  const dir = path.dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(targetPath)}.optiflow-tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );
  writeFileSync(tempPath, contents, "utf8");
  try {
    renameSync(tempPath, targetPath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup; the rename failure itself is the real error.
    }
    throw err;
  }
}

export interface WriteSettingsKeyOptions {
  /** Override "now" for testability (used for the backup filename's timestamp). */
  now?: Date;
}

export interface WriteSettingsKeyResult {
  settingsPath: string;
  /** Path of the pre-write backup, or `null` if the file didn't exist yet (nothing to back up). */
  backupPath: string | null;
}

/**
 * Reads `settingsPath` (missing/empty treated as `{}`), backs it up if it
 * existed, sets `data[key] = value` (every other key is preserved
 * byte-for-semantic-equivalent — only `key` is touched), and atomically
 * writes the result back. Throws (without writing anything) if the existing
 * file is malformed — see `readSettingsFile`.
 */
export function writeSettingsKey(
  settingsPath: string,
  key: string,
  value: unknown,
  options: WriteSettingsKeyOptions = {}
): WriteSettingsKeyResult {
  const data = readSettingsFile(settingsPath);
  const nowMs = (options.now ?? new Date()).getTime();
  const backupPath = backupSettingsFile(settingsPath, nowMs);
  data[key] = value;
  atomicWriteFile(settingsPath, `${JSON.stringify(data, null, 2)}\n`);
  return { settingsPath, backupPath };
}

export interface RemoveSettingsKeyOptions {
  now?: Date;
}

export interface RemoveSettingsKeyResult {
  removed: boolean;
  backupPath: string | null;
}

/**
 * Removes `key` from `settingsPath` if present (backing up first), leaving
 * every other key untouched. No-ops (no backup, no write) if the key isn't
 * there at all.
 */
export function removeSettingsKey(
  settingsPath: string,
  key: string,
  options: RemoveSettingsKeyOptions = {}
): RemoveSettingsKeyResult {
  const data = readSettingsFile(settingsPath);
  if (!(key in data)) {
    return { removed: false, backupPath: null };
  }
  const nowMs = (options.now ?? new Date()).getTime();
  const backupPath = backupSettingsFile(settingsPath, nowMs);
  delete data[key];
  atomicWriteFile(settingsPath, `${JSON.stringify(data, null, 2)}\n`);
  return { removed: true, backupPath };
}

// ---------------------------------------------------------------------------
// Backup discovery / whole-file restore.
// ---------------------------------------------------------------------------

export interface BackupInfo {
  backupPath: string;
  timestampMs: number;
}

/**
 * Finds the most recent `<settingsPath>.optiflow-backup-<epochMs>` file
 * next to `settingsPath`, if any — determined by parsing the numeric
 * suffix and taking the max, never by `readdir` order or filesystem mtime
 * (mtime can be perturbed by a copy/checkout independent of when the
 * backup was actually taken; same reasoning `docs/modules.md` documents
 * for checkpoint pruning).
 */
export function findLatestBackup(settingsPath: string): BackupInfo | null {
  const dir = path.dirname(settingsPath);
  const base = path.basename(settingsPath);
  if (!existsSync(dir)) return null;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  const prefix = `${base}${BACKUP_MARKER}`;
  let best: BackupInfo | null = null;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const suffix = entry.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const timestampMs = Number.parseInt(suffix, 10);
    if (!Number.isFinite(timestampMs)) continue;
    if (!best || timestampMs > best.timestampMs) {
      best = { backupPath: path.join(dir, entry), timestampMs };
    }
  }
  return best;
}

export interface RestoreSettingsBackupOptions {
  now?: Date;
}

export type RestoreSettingsBackupResult =
  | { status: "restored"; settingsPath: string; fromBackup: string; preRestoreBackup: string | null }
  | { status: "no-backup-found"; settingsPath: string };

/**
 * Restores `settingsPath` from its most recent `.optiflow-backup-<ts>` file
 * (whole-file restore, matching what the task asks for and what a user who
 * added unrelated keys after install would expect to be told about). Takes
 * a fresh backup of the pre-restore state first, so the restore itself is
 * reversible.
 */
export function restoreSettingsBackup(
  settingsPath: string,
  options: RestoreSettingsBackupOptions = {}
): RestoreSettingsBackupResult {
  const latest = findLatestBackup(settingsPath);
  if (!latest) {
    return { status: "no-backup-found", settingsPath };
  }
  const nowMs = (options.now ?? new Date()).getTime();
  const preRestoreBackup = backupSettingsFile(settingsPath, nowMs, PRERESTORE_MARKER);
  const contents = readFileSync(latest.backupPath, "utf8");
  atomicWriteFile(settingsPath, contents);
  return {
    status: "restored",
    settingsPath,
    fromBackup: latest.backupPath,
    preRestoreBackup,
  };
}

// ---------------------------------------------------------------------------
// statusLine-specific wiring (the only key actually activated today).
// ---------------------------------------------------------------------------

/**
 * Substring searched for (after normalizing `\` to `/`) inside an existing
 * `statusLine.command` string to recognize "this is optiflow's own
 * statusline, safe to treat as ours" — see docs/statusline-manual-setup.md
 * for the exact command shape optiflow writes.
 */
export const OPTIFLOW_STATUSLINE_MARKER = "plugin/scripts/statusline.mjs";

/** True if `value` looks like a `statusLine` object optiflow itself wrote. */
export function isOptiflowStatusLineValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = (value as Record<string, unknown>).command;
  if (typeof command !== "string") return false;
  return command.replace(/\\/g, "/").includes(OPTIFLOW_STATUSLINE_MARKER);
}

/** Builds the `statusLine` value optiflow writes, pointing at `scriptPath` (an absolute path). */
export function buildOptiflowStatusLineValue(scriptPath: string): Record<string, unknown> {
  return {
    type: "command",
    command: `node "${scriptPath}"`,
    padding: 0,
  };
}

export interface SetOptiflowStatusLineOptions {
  /** Overwrite a different, non-optiflow statusLine (still backs it up first). */
  force?: boolean;
  now?: Date;
}

export type SetOptiflowStatusLineResult =
  | { status: "written"; settingsPath: string; backupPath: string | null }
  | { status: "already-active"; settingsPath: string }
  | { status: "refused-foreign"; settingsPath: string; existing: unknown };

/**
 * Activates optiflow's statusline in `settingsPath`. `statusLine` is
 * single-valued/global in Claude Code settings (plan Risk R5) — if a
 * *different* statusLine is already configured, this refuses and returns
 * `"refused-foreign"` rather than silently clobbering it, unless
 * `options.force` is set. Re-running when optiflow's own statusline is
 * already active is a no-op (`"already-active"`) so repeated installs don't
 * accumulate backup files.
 */
export function setOptiflowStatusLine(
  settingsPath: string,
  scriptPath: string,
  options: SetOptiflowStatusLineOptions = {}
): SetOptiflowStatusLineResult {
  const data = readSettingsFile(settingsPath);
  const existing = data.statusLine;

  if (existing !== undefined) {
    if (isOptiflowStatusLineValue(existing)) {
      return { status: "already-active", settingsPath };
    }
    if (!options.force) {
      return { status: "refused-foreign", settingsPath, existing };
    }
  }

  const value = buildOptiflowStatusLineValue(scriptPath);
  const { backupPath } = writeSettingsKey(settingsPath, "statusLine", value, { now: options.now });
  return { status: "written", settingsPath, backupPath };
}

export interface UninstallOptiflowStatusLineOptions {
  /** Remove/restore over a non-optiflow statusLine anyway (the user changed it since install). */
  force?: boolean;
  now?: Date;
}

export type UninstallOptiflowStatusLineResult =
  | {
      status: "restored-from-backup";
      settingsPath: string;
      fromBackup: string;
      preRestoreBackup: string | null;
    }
  | { status: "key-removed"; settingsPath: string; backupPath: string | null }
  | { status: "refused-foreign-statusline"; settingsPath: string; existing: unknown }
  | { status: "no-statusline-to-remove"; settingsPath: string }
  | { status: "settings-file-missing"; settingsPath: string };

/**
 * Reverses `setOptiflowStatusLine`. Two genuinely different "nothing to
 * restore from" cases are distinguished deliberately (see the task's
 * uninstall brief):
 *
 * - optiflow activated the statusline on a machine that already HAD a
 *   settings.json -> a `.optiflow-backup-<ts>` file exists -> whole-file
 *   restore from it.
 * - optiflow activated it on a machine with NO settings.json at all (so no
 *   backup was ever created, by design — nothing to lose) -> just remove
 *   the `statusLine` key, since there is no prior file to restore.
 *
 * If the *current* statusLine doesn't look like optiflow's own (the user
 * reconfigured it after install), this refuses to touch it — restoring an
 * old backup, or removing the key, would both silently discard their newer
 * choice — unless `options.force` is set.
 *
 * The `existing === undefined` ("nothing currently set") check deliberately
 * runs *before* consulting any backup file: a real, restorable backup from
 * a prior install is never deleted after a successful restore (it's still
 * legitimately "the most recent backup" if something goes looking again),
 * so without this ordering a second `uninstall` call — once there's no
 * longer a statusLine key to reverse — would restore from that same old
 * backup all over again instead of correctly reporting "nothing to do".
 * This is what makes repeated `uninstall` calls converge/idempotent rather
 * than looping.
 */
export function uninstallOptiflowStatusLine(
  settingsPath: string,
  options: UninstallOptiflowStatusLineOptions = {}
): UninstallOptiflowStatusLineResult {
  if (!existsSync(settingsPath)) {
    return { status: "settings-file-missing", settingsPath };
  }

  const data = readSettingsFile(settingsPath);
  const existing = data.statusLine;

  if (existing === undefined) {
    return { status: "no-statusline-to-remove", settingsPath };
  }

  const looksLikeOurs = isOptiflowStatusLineValue(existing);
  if (!looksLikeOurs && !options.force) {
    return { status: "refused-foreign-statusline", settingsPath, existing };
  }

  const latest = findLatestBackup(settingsPath);
  if (latest) {
    const restored = restoreSettingsBackup(settingsPath, { now: options.now });
    if (restored.status === "restored") {
      return {
        status: "restored-from-backup",
        settingsPath,
        fromBackup: restored.fromBackup,
        preRestoreBackup: restored.preRestoreBackup,
      };
    }
  }

  const removed = removeSettingsKey(settingsPath, "statusLine", { now: options.now });
  return { status: "key-removed", settingsPath, backupPath: removed.backupPath };
}
