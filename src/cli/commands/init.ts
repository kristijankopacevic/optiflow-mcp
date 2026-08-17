// `optiflow init` — scaffolds a project-local `optiflow.config.json` from
// `DEFAULT_CONFIG` (src/config/defaults.ts), so a user gets a real, valid,
// fully-commented starting point to edit rather than having to hand-write
// the shape documented in docs/modules.md from scratch. Refuses to
// overwrite an existing file unless `--force`, mirroring the same
// don't-clobber-silently posture `settings-writer.ts` uses for settings.json.

import type { Command } from "commander";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG } from "../../config/defaults.js";

export interface InitCliOptions {
  force?: boolean;
  cwd?: string;
}

export interface InitCliResult {
  wrote: boolean;
  path: string;
  message: string;
}

/** Pure-ish core (only touches the filesystem, no stdin/argv parsing) — directly testable. */
export function runInitCli(options: InitCliOptions = {}): InitCliResult {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.join(cwd, "optiflow.config.json");

  if (existsSync(configPath) && !options.force) {
    return {
      wrote: false,
      path: configPath,
      message: `optiflow.config.json already exists at ${configPath} — use --force to overwrite.`,
    };
  }

  const contents = `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`;
  writeFileSync(configPath, contents, "utf8");

  return {
    wrote: true,
    path: configPath,
    message: `Wrote ${configPath}. See docs/modules.md for what each key does, or README.md to get started.`,
  };
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold a project-local optiflow.config.json from the built-in defaults.")
    .option("--force", "overwrite an existing optiflow.config.json")
    .action((opts: { force?: boolean }) => {
      const result = runInitCli({ force: opts.force });
      console.log(result.message);
      if (!result.wrote) process.exitCode = 1;
    });
}
