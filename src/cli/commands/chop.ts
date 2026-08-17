// `optiflow chop <command...>` — a CLI-registered alias for the same logic
// `plugin/bin/optiflow-chop` runs (both call into `runWrapper` from
// `chop/wrapper-core.ts`; nothing is duplicated). Exists so a user who has
// `optiflow` on PATH but hasn't necessarily wired up the plugin's own bin
// shim can still run `optiflow chop git status` directly, e.g. to test
// filtering/config behavior ad hoc.
//
// Commander eats everything after `chop` into the variadic `command` array
// as-is; no re-parsing/re-quoting happens here (that would reopen the exact
// quoting hazards `chop/win-spawn.ts` already solves once, correctly, inside
// `runWrapper`).

import type { Command } from "commander";
import { runWrapper, type WrapperResult } from "../../chop/wrapper-core.js";

/**
 * Pure core (given a resolved `minOutputBytes`, no config/env lookups of its
 * own) — directly testable without mocking `config/load.js` or spawning a
 * real child process, matching the pattern the other CLI commands use.
 */
export function runChopCli(command: string[], minOutputBytes: number): WrapperResult | { exitCode: number; stdout: string; stderr: string } {
  const [binary, ...args] = command;
  if (!binary) {
    return { exitCode: 2, stdout: "", stderr: "optiflow chop: no command given\n" };
  }
  return runWrapper(binary, args, { minOutputBytes });
}

export function registerChopCommand(program: Command): void {
  program
    .command("chop <command...>")
    .description(
      "Run a command through optiflow's chop filters directly (same logic as the optiflow-chop bin the PreToolUse hook invokes)."
    )
    // Without this, Commander's root `-V/--version` (and any other global
    // option) can intercept a flag meant for the WRAPPED command — e.g.
    // `optiflow chop git --version` would print optiflow's own version
    // instead of running `git --version` (confirmed empirically).
    // passThroughOptions() stops Commander from parsing anything past the
    // `chop` boundary as an option at all; allowUnknownOption alone doesn't
    // prevent the root program from claiming a recognized flag like -V.
    .allowUnknownOption(true)
    .passThroughOptions()
    .action(async (command: string[]) => {
      let minOutputBytes = 0;
      try {
        const { loadConfig } = await import("../../config/load.js");
        minOutputBytes = loadConfig().config.chop.minOutputBytes;
      } catch {
        // Config load failing must never block running the wrapped command.
      }

      const result = runChopCli(command, minOutputBytes);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });
}
