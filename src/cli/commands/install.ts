// `optiflow install [--statusline|--no-statusline] [--force]
// [--allow-headroom-wrap] [--settings-path <path>]` — Phase 8's real
// installer, replacing the stub in `src/cli/index.ts`. (`runInstallCli`'s
// `home` option also exists for programmatic/test callers — see
// `RunInstallOptions` — but is deliberately not exposed as its own CLI
// flag today; `--settings-path` is the flag a real user needs.)
//
// Mirrors `doctor.ts`/`toon.ts`'s pattern: this file is thin commander
// wiring around a directly-testable core (`runInstallCli`) that never
// touches `process.argv`/real stdout, so tests can point it at a scratch
// settings.json instead of the real `~/.claude/settings.json`.
//
// Two things this command does that `doctor` (read-only, report-only)
// deliberately does not:
//
// 1. **Refuses to proceed** (non-zero exit, no statusline write attempted)
//    when `detect.ts`'s `detectHeadroomWrap` signal fires (plan Risk R1),
//    unless `--allow-headroom-wrap` is passed. `doctor` only reports this as
//    a warning; per the plan, `install` is the one place that must act on
//    it. Respect the signal's own documented limitation (see detect.ts's
//    module comment) rather than inventing a stronger check that doesn't
//    exist: it's a configuration-level signal, not a live-process check.
// 2. **Never touches settings.json without an explicit flag.** With neither
//    `--statusline` nor `--no-statusline` given, this prints the manual
//    setup instructions (docs/statusline-manual-setup.md) and makes no
//    write at all — matching that doc's already-established conservative
//    posture.

import type { Command } from "commander";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runDoctor } from "../../install/doctor.js";
import {
  resolveDefaultSettingsPath,
  setOptiflowStatusLine,
} from "../../install/settings-writer.js";

/**
 * Resolves the absolute path to the bundled statusline script this repo
 * ships. Tries the bundled layout first (`plugin/dist/cli/index.js` ->
 * `plugin/scripts/statusline.mjs`, i.e. two directories up from wherever
 * this bundle's own `import.meta.url` resolves to at runtime — esbuild
 * bundles every source module into that one output file, so this is
 * accurate regardless of which source file the call happens to live in),
 * falling back to the unbundled dev/test source layout
 * (`src/cli/commands/install.ts` -> repo root's `plugin/scripts/`).
 */
export function defaultStatuslineScriptPath(): string {
  const hereDir = path.dirname(fileURLToPath(import.meta.url));

  const bundledPluginRoot = path.resolve(hereDir, "..", "..");
  const bundledCandidate = path.join(bundledPluginRoot, "scripts", "statusline.mjs");
  if (existsSync(bundledCandidate)) return bundledCandidate;

  const devRepoRoot = path.resolve(hereDir, "..", "..", "..");
  return path.join(devRepoRoot, "plugin", "scripts", "statusline.mjs");
}

export interface RunInstallOptions {
  cwd?: string;
  /** Overrides os.homedir() for both the R1 headroom-wrap probe and the default settings.json path. */
  home?: string;
  /** Explicit override of the Claude Code settings file to write statusLine into. */
  settingsPath?: string;
  statusline?: boolean;
  noStatusline?: boolean;
  /** Overwrite a different, non-optiflow statusLine (still backs it up first). */
  force?: boolean;
  /** Bypass the R1 headroom-wrap refusal. Deliberately a separate flag from `force` (which only ever means "clobber a foreign statusLine"). */
  allowHeadroomWrap?: boolean;
  now?: Date;
  /** Override the absolute path baked into the written statusLine command (tests only). */
  scriptPath?: string;
}

export interface RunInstallResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runInstallCli(options: RunInstallOptions = {}): RunInstallResult {
  const lines: string[] = [];
  const errLines: string[] = [];

  lines.push("optiflow install");
  lines.push("================");
  lines.push("");

  const doctorReport = runDoctor({ cwd: options.cwd, home: options.home });
  lines.push("Environment check (see `optiflow doctor` for the full report):");
  lines.push(`  Node version: ${doctorReport.node.nodeVersion}`);
  lines.push(`  token-optimizer pin: ${doctorReport.tokenOptimizerPin.status}`);
  lines.push(`  headroom on PATH: ${doctorReport.headroomOnPath.present ? "yes" : "no"}`);
  lines.push("");

  if (doctorReport.headroomWrap.wrapped && !options.allowHeadroomWrap) {
    errLines.push(
      "REFUSED: Claude Code appears configured to route through a headroom proxy (plan Risk R1)."
    );
    errLines.push(
      "Installing optiflow's plugin/hooks alongside an active headroom-wrap configuration is unsupported and can conflict."
    );
    for (const signal of doctorReport.headroomWrap.signals) {
      const parts: string[] = [];
      if (signal.envKeysFound.length > 0) parts.push(`env keys: ${signal.envKeysFound.join(", ")}`);
      if (signal.hookMarkersFound.length > 0) {
        parts.push(`hook markers: ${signal.hookMarkersFound.join(", ")}`);
      }
      errLines.push(`  - ${signal.filePath} (${parts.join("; ")})`);
    }
    errLines.push(
      "This is a configuration-level signal, not a live-process check — a dead proxy can leave it"
    );
    errLines.push(
      "behind. There is no `headroom unwrap claude` command; recovery is manually removing"
    );
    errLines.push(
      "env.ANTHROPIC_BASE_URL / env.ENABLE_TOOL_SEARCH and any headroom-marked hook entries from"
    );
    errLines.push("the settings file(s) listed above, then re-running `optiflow install`.");
    errLines.push("To proceed anyway (not recommended), pass --allow-headroom-wrap.");
    return {
      stdout: `${lines.join("\n")}\n`,
      stderr: `${errLines.join("\n")}\n`,
      exitCode: 1,
    };
  }

  lines.push(
    doctorReport.headroomWrap.wrapped
      ? "Headroom wrap conflict (Risk R1): detected, but proceeding anyway (--allow-headroom-wrap)."
      : "Headroom wrap conflict (Risk R1): none detected."
  );
  lines.push("");

  const settingsPath = options.settingsPath ?? resolveDefaultSettingsPath(options.home);

  if (options.noStatusline) {
    lines.push("Statusline: skipped (--no-statusline).");
    lines.push("  See docs/statusline-manual-setup.md if you want to activate it by hand.");
  } else if (options.statusline) {
    const scriptPath = options.scriptPath ?? defaultStatuslineScriptPath();
    let result;
    try {
      result = setOptiflowStatusLine(settingsPath, scriptPath, {
        force: options.force,
        now: options.now,
      });
    } catch (err) {
      errLines.push(`Statusline: ${(err as Error).message}`);
      result = null;
    }

    if (result) {
      if (result.status === "written") {
        lines.push(`Statusline: activated in ${settingsPath}`);
        lines.push(
          result.backupPath
            ? `  Backed up previous settings to ${result.backupPath}`
            : "  No prior settings.json existed — nothing to back up."
        );
      } else if (result.status === "already-active") {
        lines.push(`Statusline: already active in ${settingsPath} (no change made).`);
      } else if (result.status === "refused-foreign") {
        errLines.push(
          `Statusline: REFUSED — ${settingsPath} already has a different statusLine configured.`
        );
        errLines.push(`  Existing value: ${JSON.stringify(result.existing)}`);
        errLines.push(
          "  Re-run with --force to back it up and overwrite it, or activate manually per docs/statusline-manual-setup.md."
        );
      }
    }
  } else {
    lines.push(
      "Statusline: not touched (default — pass --statusline to activate it, or --no-statusline to silence this message)."
    );
    lines.push("  See docs/statusline-manual-setup.md for the manual setup steps.");
  }

  lines.push("");
  lines.push("Note: `.optiflow/` checkpoints/ledger/logs are never touched by install.");

  const exitCode = errLines.length > 0 ? 1 : 0;
  return {
    stdout: `${lines.join("\n")}\n`,
    stderr: errLines.length > 0 ? `${errLines.join("\n")}\n` : "",
    exitCode,
  };
}

export function registerInstallCommand(program: Command): void {
  program
    .command("install")
    .description(
      "Run environment checks (refusing on a detected headroom-wrap conflict, plan Risk R1), then optionally activate optiflow's statusline in Claude Code's settings.json (opt-in via --statusline; the default touches nothing)."
    )
    .option("--statusline", "activate optiflow's statusline in settings.json (backs up first)")
    .option("--no-statusline", "explicitly skip statusline activation (same as the default, but silences the manual-setup note)")
    .option("--force", "with --statusline, overwrite a different existing statusLine (still backs it up first)")
    .option("--allow-headroom-wrap", "proceed even if a headroom-wrap conflict (Risk R1) is detected (not recommended)")
    .option("--settings-path <path>", "override the Claude Code settings.json path to write into (default: ~/.claude/settings.json)")
    .action((opts: Record<string, unknown>) => {
      // Commander merges `--statusline`/`--no-statusline` onto the same
      // `statusline` property (negatable-boolean convention): `true` when
      // `--statusline` was passed, `false` when `--no-statusline` was
      // passed, `undefined` when neither was — that `undefined` case is
      // the conservative default (touch nothing, print manual instructions).
      const result = runInstallCli({
        statusline: opts.statusline === true,
        noStatusline: opts.statusline === false,
        force: Boolean(opts.force),
        allowHeadroomWrap: Boolean(opts.allowHeadroomWrap),
        settingsPath: opts.settingsPath as string | undefined,
      });
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });
}
