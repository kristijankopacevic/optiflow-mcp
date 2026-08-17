// `optiflow statusline [file]` — lets a user (or a test) render the
// statusline directly from the CLI, without needing a live Claude Code
// session or hand-piping into plugin/scripts/statusline.mjs. Reuses
// `runStatusline` from src/statusline/cli.ts verbatim (that file guards its
// own `main()` behind an import.meta/argv[1] check, so importing it here
// for its exported function never triggers a second, competing stdin read).

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { runStatusline } from "../../statusline/cli.js";
import type { StatuslineInput } from "../../statusline/render.js";

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function registerStatuslineCommand(program: Command): void {
  program
    .command("statusline [file]")
    .description(
      "Render the statusline context meter from a JSON payload (file or stdin) — useful for testing outside a live Claude Code session. See docs/statusline-manual-setup.md to activate it for real."
    )
    .action(async (file: string | undefined) => {
      const output = await runStatusline(async () => {
        const raw = file ? readFileSync(file, "utf8") : await readStdinText();
        try {
          return JSON.parse(raw) as StatuslineInput;
        } catch {
          return {};
        }
      });
      process.stdout.write(output);
      process.stdout.write("\n");
    });
}
