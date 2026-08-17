// `optiflow uninstall [--force] [--purge] [--settings-path <path>] [--home
// <dir>]` — reverses `optiflow install --statusline` (see
// `install.ts`/`settings-writer.ts`). Never deletes `.optiflow/`
// checkpoints/ledger/logs by default (user data); `--purge` opts in.
//
// Mirrors install.ts's split: thin commander wiring around a directly
// testable core (`runUninstallCli`).

import type { Command } from "commander";
import { rmSync } from "node:fs";
import path from "node:path";
import { findProjectRoot, getOptiflowHome, getProjectLocalDir } from "../../core/paths.js";
import {
  resolveDefaultSettingsPath,
  uninstallOptiflowStatusLine,
} from "../../install/settings-writer.js";

export interface RunUninstallOptions {
  cwd?: string;
  /** Overrides os.homedir() for the default settings.json path. */
  home?: string;
  /** Explicit override of the Claude Code settings file to restore/clean up. */
  settingsPath?: string;
  /** Remove/restore over a non-optiflow statusLine anyway (the user changed it since install). */
  force?: boolean;
  /** Also delete .optiflow/ checkpoints (project-local) and ledger/logs/activity (user-global). Config is kept. */
  purge?: boolean;
  now?: Date;
}

export interface RunUninstallResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function purgeOptiflowData(options: { cwd?: string }): string[] {
  const removed: string[] = [];

  const projectLocalDir = getProjectLocalDir(findProjectRoot(options.cwd ?? process.cwd()));
  rmSync(projectLocalDir, { recursive: true, force: true });
  removed.push(projectLocalDir);

  const home = getOptiflowHome();
  for (const relative of ["ledger.jsonl", "logs", "activity.json"]) {
    const target = path.join(home, relative);
    rmSync(target, { recursive: true, force: true });
    removed.push(target);
  }
  // Deliberately NOT removing `<home>/config.json` — that's the user's own
  // optiflow settings, not ephemeral checkpoint/ledger/log data, and
  // `--purge` is documented as cleaning up the latter only.

  return removed;
}

export function runUninstallCli(options: RunUninstallOptions = {}): RunUninstallResult {
  const lines: string[] = [];
  const errLines: string[] = [];

  lines.push("optiflow uninstall");
  lines.push("==================");
  lines.push("");

  const settingsPath = options.settingsPath ?? resolveDefaultSettingsPath(options.home);

  let result;
  try {
    result = uninstallOptiflowStatusLine(settingsPath, { force: options.force, now: options.now });
  } catch (err) {
    errLines.push(`Statusline: ${(err as Error).message}`);
    result = null;
  }

  if (result) {
    switch (result.status) {
      case "settings-file-missing":
        lines.push(`Statusline: nothing to do — ${settingsPath} does not exist.`);
        break;
      case "no-statusline-to-remove":
        lines.push(`Statusline: nothing to do — ${settingsPath} has no statusLine key set.`);
        break;
      case "refused-foreign-statusline":
        errLines.push(
          `Statusline: REFUSED — ${settingsPath}'s current statusLine doesn't look like optiflow's own; leaving it untouched (you may have changed it since install).`
        );
        errLines.push(`  Existing value: ${JSON.stringify(result.existing)}`);
        errLines.push("  Re-run with --force to remove/restore over it anyway.");
        break;
      case "restored-from-backup":
        lines.push(`Statusline: restored ${settingsPath} from backup ${result.fromBackup}.`);
        if (result.preRestoreBackup) {
          lines.push(`  (Pre-restore state was itself backed up to ${result.preRestoreBackup}.)`);
        }
        break;
      case "key-removed":
        lines.push(
          `Statusline: removed the statusLine key from ${settingsPath} (no prior backup existed — optiflow's install never had a previous value to restore).`
        );
        if (result.backupPath) {
          lines.push(`  Backed up pre-removal settings to ${result.backupPath}.`);
        }
        break;
    }
  }

  lines.push("");
  if (options.purge) {
    const removed = purgeOptiflowData({ cwd: options.cwd });
    lines.push("--purge: removed the following (checkpoints/ledger/logs — user config.json kept):");
    for (const item of removed) lines.push(`  - ${item}`);
  } else {
    lines.push(
      ".optiflow/ checkpoints, ledger, and logs are left in place (user data) — pass --purge to also delete them."
    );
  }

  const exitCode = errLines.length > 0 ? 1 : 0;
  return {
    stdout: `${lines.join("\n")}\n`,
    stderr: errLines.length > 0 ? `${errLines.join("\n")}\n` : "",
    exitCode,
  };
}

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description(
      "Reverse `optiflow install --statusline`: restore the prior settings.json from optiflow's backup (or remove the statusLine key if no backup exists). Never deletes .optiflow/ checkpoints/ledger/logs by default."
    )
    .option("--force", "remove/restore over a statusLine that doesn't look like optiflow's own (you may have changed it since install)")
    .option("--purge", "also delete .optiflow/ checkpoints (project-local) and ledger/logs/activity (user-global); config.json is kept")
    .option("--settings-path <path>", "override the Claude Code settings.json path to restore/clean up (default: ~/.claude/settings.json)")
    .action((opts: Record<string, unknown>) => {
      const result = runUninstallCli({
        force: Boolean(opts.force),
        purge: Boolean(opts.purge),
        settingsPath: opts.settingsPath as string | undefined,
      });
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });
}
