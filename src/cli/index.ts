#!/usr/bin/env node
// optiflow CLI entry point. Bundled by esbuild to plugin/dist/cli/index.js
// (see esbuild.config.mjs); plugin/bin/optiflow requires the built bundle.

import { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerToonCommand } from "./commands/toon.js";
import { registerReportCommand } from "./commands/report.js";

const NOT_YET_IMPLEMENTED_COMMANDS: Array<{ name: string; phase: string; description: string }> = [
  { name: "statusline", phase: "4", description: "Render the statusline context meter." },
  { name: "chop", phase: "3", description: "Chop-style Bash/CLI-output interception." },
  { name: "checkpoint", phase: "7", description: "Session-handoff checkpoint/restore." },
  { name: "init", phase: "1/8", description: "Scaffold an optiflow.config.json in the current project." },
  { name: "install", phase: "8", description: "Install the optiflow plugin/hooks into Claude Code settings." },
  { name: "uninstall", phase: "8", description: "Remove the optiflow plugin/hooks and restore prior settings." },
];

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("optiflow")
    .description(
      "Orchestration layer wiring token-optimizer-mcp and headroom together, plus chop-style Bash interception, transcript analytics, a statusline context meter, session-handoff checkpoints, and TOON conversion."
    )
    .version("0.1.0");

  registerDoctorCommand(program);
  registerToonCommand(program);
  registerReportCommand(program);

  for (const stub of NOT_YET_IMPLEMENTED_COMMANDS) {
    program
      .command(stub.name)
      .description(`${stub.description} (not yet implemented — see Phase ${stub.phase} of the plan)`)
      .action(() => {
        console.log(
          `optiflow ${stub.name}: not yet implemented — see Phase ${stub.phase} of the plan.`
        );
      });
  }

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
