// NDJSON logging to ~/.optiflow/logs/<date>.ndjson. Logging must never break
// the calling hook/CLI, so every failure mode here is swallowed.

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getOptiflowHome } from "./paths.js";

export interface LogOptions {
  /** Override the log directory's parent (defaults to getOptiflowHome()). */
  home?: string;
  /** Override "now" for testability. */
  now?: Date;
}

/**
 * Appends one NDJSON line (a `{timestamp, ...entry}` object) to today's log
 * file, creating `~/.optiflow/logs/` if needed. Never throws.
 */
export function log(entry: Record<string, unknown>, options: LogOptions = {}): void {
  try {
    const home = options.home ?? getOptiflowHome();
    const dir = path.join(home, "logs");
    mkdirSync(dir, { recursive: true });
    const now = options.now ?? new Date();
    const date = now.toISOString().slice(0, 10);
    const file = path.join(dir, `${date}.ndjson`);
    const line = JSON.stringify({ timestamp: now.toISOString(), ...entry });
    appendFileSync(file, line + "\n", "utf8");
  } catch {
    // Logging must never break the calling hook/CLI.
  }
}
