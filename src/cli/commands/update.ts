// `optiflow update` — reinstall the CLI from the current master tarball.
//
// Exists because updating used to be a sequence of steps a user had to
// remember and get right in order: uninstall the global package, avoid the
// `github:` install form (which npm symlinks to a temp git clone it then
// deletes), and make sure no stale `alias optiflow=...` in a shell rc file
// is shadowing the binary that was just installed. Getting any one of those
// wrong produces a confusing failure -- either `Cannot find module
// .../plugin/bin/optiflow` or `unknown command 'savings'` -- that looks like
// a broken build rather than a stale path.
//
// So this command does the whole sequence and then verifies the result,
// rather than documenting it and hoping.
//
// NOTE ON SHADOWING: a shell alias cannot be removed from an ALREADY
// RUNNING shell by a child process. This command strips the alias from the
// rc files so it never comes back, detects that it is currently shadowed,
// and tells the user the one thing only they can do (`unalias optiflow`, or
// open a new shell). Silently succeeding while the next invocation still
// runs the old binary would be worse than saying so.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Command } from "commander";

/**
 * Deliberately the remote-tarball URL, NOT `github:kristijankopacevic/...`.
 * On npm 11 the `github:` form symlinks the global install to
 * `_cacache/tmp/git-clone-XXXX`, which npm then cleans up — leaving working
 * bin shims pointing at nothing. Verified directly; see README.
 */
export const TARBALL_URL =
  "https://github.com/kristijankopacevic/optiflow-mcp/archive/refs/heads/master.tar.gz";

const RC_FILES = [".bashrc", ".bash_profile", ".zshrc", ".profile"];

export interface StripAliasResult {
  file: string;
  removedLines: number;
}

/** Matches any line defining an `optiflow` shell alias, however quoted. */
const ALIAS_RE = /^\s*alias\s+optiflow\s*=/;

/**
 * Removes `alias optiflow=...` lines from the user's shell rc files.
 *
 * Earlier documentation told users to add exactly such an alias, pointing at
 * the plugin cache, because that was the only working copy before the npm
 * packaging was fixed. It now pins them to whatever build the plugin cache
 * happens to hold and silently shadows every update — so this cleans up
 * after that advice.
 *
 * Returns which files were touched. Never throws: an unreadable or
 * unwritable rc file is reported as untouched rather than failing the whole
 * update.
 */
export function stripOptiflowAliases(home: string = homedir()): StripAliasResult[] {
  const results: StripAliasResult[] = [];
  for (const name of RC_FILES) {
    const file = path.join(home, name);
    try {
      if (!existsSync(file)) continue;
      const original = readFileSync(file, "utf8");
      const lines = original.split("\n");
      const kept = lines.filter((line) => !ALIAS_RE.test(line));
      const removed = lines.length - kept.length;
      if (removed > 0) {
        // Back up before editing someone's shell config, always — the same
        // rule `src/install/settings-writer.ts` follows for settings.json.
        // These files carry a great deal more than our one alias.
        writeFileSync(`${file}.optiflow-backup-${Date.now()}`, original, "utf8");
        writeFileSync(file, kept.join("\n"), "utf8");
        results.push({ file, removedLines: removed });
      }
    } catch {
      // An rc file we cannot read or write is not a reason to abort the
      // update — the npm install below is the part that matters.
    }
  }
  return results;
}

export interface RunUpdateOptions {
  /** Injected for tests; defaults to the real npm invocation. */
  runNpm?: (args: string[]) => void;
  home?: string;
}

function defaultRunNpm(args: string[]): void {
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    stdio: "inherit",
  });
}

export function runUpdateCli(options: RunUpdateOptions = {}): string[] {
  const runNpm = options.runNpm ?? defaultRunNpm;
  const lines: string[] = [];

  const stripped = stripOptiflowAliases(options.home);
  for (const result of stripped) {
    lines.push(
      `Removed ${result.removedLines} stale \`alias optiflow=\` line(s) from ${result.file}`
    );
  }

  // Uninstall first. The broken `github:` install form leaves a DANGLING
  // SYMLINK, and installing over it does not always replace it cleanly.
  try {
    runNpm(["uninstall", "-g", "optiflow-mcp"]);
  } catch {
    // Nothing installed, or a permissions problem on a directory we are
    // about to overwrite anyway. Either way the install below is what counts.
  }

  runNpm(["install", "-g", TARBALL_URL]);

  lines.push("");
  lines.push("Updated. Verify with:");
  lines.push("  optiflow --version && optiflow savings");
  if (stripped.length > 0) {
    lines.push("");
    lines.push("An alias was shadowing the real binary in this shell. Run:");
    lines.push("  unalias optiflow; hash -r");
    lines.push("...or just open a new terminal. A child process cannot remove");
    lines.push("an alias from the shell that launched it.");
  }
  return lines;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description(
      "Reinstall the optiflow CLI from the latest master, clearing any stale global " +
        "install or shell alias that would shadow it."
    )
    .action(() => {
      try {
        for (const line of runUpdateCli()) {
          process.stdout.write(line + "\n");
        }
      } catch (error) {
        process.stderr.write(
          `[optiflow update] failed: ${error instanceof Error ? error.message : String(error)}\n` +
            `You can run it by hand:\n  npm uninstall -g optiflow-mcp\n  npm install -g ${TARBALL_URL}\n`
        );
        process.exitCode = 1;
      }
    });
}
