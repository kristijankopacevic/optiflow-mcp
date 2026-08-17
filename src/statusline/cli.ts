// Module 3: the statusline entry point Claude Code's `statusLine.command`
// actually invokes (see docs/statusline-manual-setup.md for exactly what a
// user/the future installer needs to add to settings.json — U1 finding:
// Claude Code only ever reads `statusLine` from the user's/project's own
// settings.json, never from a plugin manifest or a plugin-shipped
// settings.json, so this phase does not attempt to self-register one).
//
// Deliberately thin, mirroring `src/chop/pretooluse.ts`'s pattern: all real
// logic (the pure `render()`, the segment functions) lives elsewhere and is
// directly unit-testable without touching stdin/stdout; this file's only
// job is I/O plumbing — read stdin, do the few cheap/bounded filesystem
// reads `render.ts` is forbidden from doing itself, call `render()`, write
// the result. Must stay fast end-to-end: Claude Code debounces statusline
// updates at ~300ms and CANCELS (never queues) an in-flight script on the
// next trigger.
//
// Guarded with the same `import.meta.url`/`process.argv[1]` check as
// `pretooluse.ts`/`posttooluse-mcp.ts` (not the unconditional pattern
// `chop/wrapper.ts` uses) because this file, like those two, IS the direct
// process entry point Claude Code's `node ".../statusline.mjs"` invokes —
// `process.argv[1]` will match this module's own URL.

import { pathToFileURL } from "node:url";
import { readHookInput } from "../core/hook-io.js";
import { render, DEFAULT_RENDER_CONFIG, type StatuslineInput } from "./render.js";
import { readActivityBeacon, readRecentSavings, readStatuslineConfig, type StatuslineIoOptions } from "./io.js";

/**
 * Reads stdin (via `readHookInput`, reused as-is: it's a generic
 * read-everything-then-`JSON.parse` helper with zero extra deps, not
 * hook-response-shaped despite living in `hook-io.ts` — it never assumes
 * anything about the payload beyond "valid JSON"), does the handful of
 * cheap/bounded local reads, and returns the rendered statusline string.
 * Exported (rather than folded into `main`) so tests can exercise the full
 * I/O-assembly path with injected stdin/options instead of real files.
 */
export async function runStatusline(
  readInput: () => Promise<StatuslineInput | null> = () => readHookInput<StatuslineInput>(),
  ioOptions: StatuslineIoOptions = {}
): Promise<string> {
  const input = (await readInput()) ?? {};
  const config = { ...DEFAULT_RENDER_CONFIG, ...readStatuslineConfig(ioOptions) };
  const activity = readActivityBeacon(ioOptions);
  const savings = readRecentSavings(ioOptions);
  return render(input, { config, activity, savings, now: ioOptions.now });
}

async function main(): Promise<void> {
  const output = await runStatusline();
  process.stdout.write(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}
