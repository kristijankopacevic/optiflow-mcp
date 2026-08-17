// `optiflow toon [file]` — standalone CLI entry point for Module 5. Reads
// input from a file path argument if given, otherwise from stdin; runs the
// full detect -> convert -> guard pipeline via `maybeConvertToToon`; prints
// the TOON output when it was approved, or the untouched original with a
// clear stderr message explaining why conversion was skipped otherwise.
//
// Mirrors `doctor.ts`'s pattern: this file is thin commander wiring only.
// The actual logic (`runToonCli`) is a separate, directly-testable function
// that takes the input text + resolved config and returns the two output
// streams as plain strings, so tests never need to spawn a process or read
// real stdin/argv.

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../config/load.js";
import { maybeConvertToToon, type ToonConfig } from "../../toon/index.js";

export interface ToonCliOptions {
  minSavings?: number;
  minRows?: number;
}

export interface ToonCliResult {
  /** What should be written to stdout: the TOON output on success, the untouched original otherwise. */
  stdout: string;
  /** A one-line explanation written to stderr (converted-with-numbers, or skipped-with-reason). */
  stderr: string;
  /** True if TOON conversion was used. */
  converted: boolean;
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Pure core of the `toon` CLI command — no file/stdin I/O, directly testable. */
export function runToonCli(input: string, config: ToonConfig): ToonCliResult {
  const result = maybeConvertToToon(input, config);

  if (result.ok) {
    const guard = result.guard;
    const stderr = guard
      ? `[optiflow toon] converted (${result.format}): ${guard.tokensBefore} -> ${guard.tokensAfter} tokens (${guard.savingsPercent.toFixed(1)}% saved)\n`
      : `[optiflow toon] converted (${result.format ?? "unknown"})\n`;
    return { stdout: withTrailingNewline(result.output), stderr, converted: true };
  }

  return {
    stdout: withTrailingNewline(input),
    stderr: `[optiflow toon] skipped: ${result.reason}\n`,
    converted: false,
  };
}

async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function registerToonCommand(program: Command): void {
  program
    .command("toon [file]")
    .description(
      "Convert a JSON/CSV file (or stdin) to TOON when it saves tokens; YAML is detected but not yet converted. Guarded by toon.minSavingsPercent/toon.minRows in optiflow.config.json."
    )
    .option("--min-savings <percent>", "override toon.minSavingsPercent for this run", (v) => Number.parseFloat(v))
    .option("--min-rows <count>", "override toon.minRows for this run", (v) => Number.parseInt(v, 10))
    .action(async (file: string | undefined, opts: ToonCliOptions) => {
      const input = file ? readFileSync(file, "utf8") : await readStdin();
      const { config } = loadConfig();
      const toonConfig: ToonConfig = {
        enabled: config.toon.enabled,
        minSavingsPercent: opts.minSavings ?? config.toon.minSavingsPercent,
        minRows: opts.minRows ?? config.toon.minRows,
      };

      const { stdout, stderr } = runToonCli(input, toonConfig);
      process.stdout.write(stdout);
      process.stderr.write(stderr);
    });
}
