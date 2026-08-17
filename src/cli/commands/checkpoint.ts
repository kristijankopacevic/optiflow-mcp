// `optiflow checkpoint [notes] [--next-step <text>] [--open-file <path>]
// [--session <id>] [--restore [id]] [--full] [--list]` — Module 4's
// scriptable/non-slash-command CLI entry point. This is the ONLY subcommand
// name Phase 2 already stubbed for this phase (`src/cli/index.ts`'s
// `NOT_YET_IMPLEMENTED_COMMANDS` had `checkpoint`, but no separate `restore`
// entry) — so, per that precedent, `optiflow checkpoint` WRITES (the
// default), RESTORES (`--restore`), and LISTS (`--list`) rather than
// inventing separate top-level command names for each. `--list` takes
// precedence if given alongside `--restore`/notes (checked first in the
// action handler below) — listing is a read-only, side-effect-free query
// and there's no sensible combination where a caller wants both at once.
//
// Mirrors `report.ts`/`toon.ts`'s pattern: thin commander wiring plus
// directly-testable pure-ish cores (`runCheckpointWrite`/
// `runCheckpointRestore`/`runCheckpointList`) that never touch
// `process.argv`/real stdout.
//
// `decisions[]`/`nextSteps[]`/`openFiles[]` come ONLY from this manual path
// (see `src/handoff/checkpoint.ts`'s module header on why the auto-hooks
// can never populate them) — `notes` (the positional arg) becomes the sole
// `decisions[]` entry when given, matching the plan's exact wording for
// `/optiflow:checkpoint [notes]`: "optional free-text notes/decisions".
//
// `--restore`'s output is capped at 10,000 chars by default (see
// `src/handoff/restore.ts`'s module header) — `--full` opts out for a
// genuine full-fidelity dump.

import type { Command } from "commander";
import {
  createCheckpoint,
  listCheckpointFiles,
  resolveCheckpointDir,
} from "../../handoff/checkpoint.js";
import { loadCheckpoint, renderRestoreMarkdown, resolveCheckpoint } from "../../handoff/restore.js";

export interface CheckpointCliResult {
  stdout: string;
  stderr: string;
}

export interface CheckpointWriteOptions {
  cwd?: string;
  home?: string;
  now?: Date;
  sessionId?: string;
  notes?: string;
  nextSteps?: string[];
  openFiles?: string[];
}

/** The testable core of the write path — no process.argv/real stdout. */
export function runCheckpointWrite(options: CheckpointWriteOptions = {}): CheckpointCliResult {
  const cwd = options.cwd ?? process.cwd();
  const sessionId = options.sessionId ?? `manual-${(options.now ?? new Date()).getTime()}`;
  const decisions = options.notes ? [options.notes] : [];

  const { write } = createCheckpoint(
    {
      sessionId,
      cwd,
      decisions,
      nextSteps: options.nextSteps ?? [],
      openFiles: options.openFiles ?? [],
    },
    { cwd: options.cwd, home: options.home, now: options.now }
  );

  return {
    stdout: `[optiflow checkpoint] saved ${write.id} -> ${write.filePath}\n`,
    stderr: "",
  };
}

export interface CheckpointRestoreOptions {
  cwd?: string;
  home?: string;
  id?: string;
  /** Opt out of the default 10,000-char cap for a full-fidelity dump (see restore.ts's module header). */
  full?: boolean;
}

/** The testable core of the restore path — capped at 10,000 chars by default (see restore.ts's module header); `full: true` opts out. */
export function runCheckpointRestore(options: CheckpointRestoreOptions = {}): CheckpointCliResult {
  const dir = resolveCheckpointDir({ cwd: options.cwd, home: options.home });
  const checkpoint = resolveCheckpoint(dir, options.id);
  return {
    stdout: `${renderRestoreMarkdown(checkpoint, { capChars: options.full ? false : undefined })}\n`,
    stderr: "",
  };
}

export interface CheckpointListOptions {
  cwd?: string;
  home?: string;
}

/**
 * The testable core of the list path: every checkpoint in the resolved
 * directory, newest first (by in-file `timestamp`, same ordering
 * `checkpoint.ts`'s `pruneCheckpoints`/`restore.ts`'s `findLatestCheckpoint`
 * use — never filename or mtime order), one line each with id / taken-at /
 * branch / decision count. Malformed files are silently omitted (see
 * `listCheckpointFiles`'s own doc on why that's the safe default), not
 * reported as errors.
 */
export function runCheckpointList(options: CheckpointListOptions = {}): CheckpointCliResult {
  const dir = resolveCheckpointDir({ cwd: options.cwd, home: options.home });
  const entries = listCheckpointFiles(dir).sort((a, b) => b.timestamp - a.timestamp);

  if (entries.length === 0) {
    return {
      stdout: "No checkpoints found yet. Run `optiflow checkpoint [notes]` to create one.\n",
      stderr: "",
    };
  }

  const lines = entries.map((entry) => {
    const checkpoint = loadCheckpoint(entry.filePath);
    const when = new Date(entry.timestamp).toISOString();
    const branch = checkpoint?.gitBranch ?? "(no branch)";
    const decisionCount = checkpoint?.decisions.length ?? 0;
    return `${entry.id}  ${when}  ${branch}  (${decisionCount} decision${decisionCount === 1 ? "" : "s"})`;
  });

  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerCheckpointCommand(program: Command): void {
  program
    .command("checkpoint [notes]")
    .description(
      "Save a session-handoff checkpoint under .optiflow/checkpoints/ (default), render one with --restore, or enumerate them with --list. notes (if given) becomes the checkpoint's sole decisions[] entry."
    )
    .option(
      "--restore [id]",
      "render a checkpoint instead of writing one: most recent if <id> is omitted, or the checkpoint matching <id>. Output is capped at 10,000 chars by default (see --full)."
    )
    .option("--full", "with --restore, render the full, unbounded markdown instead of the default 10,000-char-capped output")
    .option(
      "--list",
      "list every checkpoint in the resolved directory, newest first, instead of writing or restoring one. Takes precedence over --restore/notes if given together."
    )
    .option("--session <id>", "override the checkpoint's sessionId (default: a generated manual-<timestamp> id)")
    .option("--next-step <text>", "append a next-step item (repeatable)", collect, [] as string[])
    .option("--open-file <path>", "record a currently-open file path (repeatable)", collect, [] as string[])
    .action((notes: string | undefined, opts: Record<string, unknown>) => {
      if (opts.list) {
        const { stdout } = runCheckpointList();
        process.stdout.write(stdout);
        return;
      }

      if (opts.restore !== undefined) {
        const id = typeof opts.restore === "string" ? opts.restore : undefined;
        const { stdout } = runCheckpointRestore({ id, full: Boolean(opts.full) });
        process.stdout.write(stdout);
        return;
      }

      const { stdout } = runCheckpointWrite({
        notes,
        sessionId: opts.session as string | undefined,
        nextSteps: opts.nextStep as string[] | undefined,
        openFiles: opts.openFile as string[] | undefined,
      });
      process.stdout.write(stdout);
    });
}
