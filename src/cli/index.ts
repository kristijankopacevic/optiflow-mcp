#!/usr/bin/env node
// optiflow CLI entry point. Bundled by esbuild to plugin/dist/cli/index.js
// (see esbuild.config.mjs); plugin/bin/optiflow requires the built bundle.

import { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerToonCommand } from "./commands/toon.js";
import { registerReportCommand } from "./commands/report.js";
import { registerCheckpointCommand } from "./commands/checkpoint.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerUninstallCommand } from "./commands/uninstall.js";
import { registerStatuslineCommand } from "./commands/statusline.js";
import { registerChopCommand } from "./commands/chop.js";
import { registerInitCommand } from "./commands/init.js";
import { registerCcrRetrieveCommand } from "./commands/ccr-retrieve.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("optiflow")
    .description(
      "A single plugin merging token-optimizer-mcp's smart_*/analytics MCP tools and enforcement hooks with headroom's real Rust compression core (via WASM), plus chop-style Bash interception, transcript analytics, a statusline context meter, session-handoff checkpoints, and TOON conversion."
    )
    .version("0.1.0")
    // Required for the `chop` subcommand's .passThroughOptions() (see
    // chop.ts) — without it, Commander refuses to let a subcommand pass
    // options through untouched, because the root program's own global
    // options (like -V/--version) would otherwise silently intercept a flag
    // meant for the wrapped command, e.g. `optiflow chop git --version`
    // printing optiflow's own version instead of running `git --version`.
    .enablePositionalOptions();

  registerDoctorCommand(program);
  registerToonCommand(program);
  registerReportCommand(program);
  registerCheckpointCommand(program);
  registerInstallCommand(program);
  registerUninstallCommand(program);
  registerStatuslineCommand(program);
  registerChopCommand(program);
  registerInitCommand(program);
  registerCcrRetrieveCommand(program);

  return program;
}

// This file is only ever run as the CLI entry point (bundled to
// plugin/dist/cli/index.js, required by plugin/bin/optiflow) — not imported
// as a library — so it parses argv unconditionally rather than guessing at
// a "is this the main module" check.
buildProgram()
  .parseAsync(process.argv)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
