// Cross-platform-safe process spawning for `wrapper.ts`.
//
// LOAD-BEARING PROPERTY: argv is spawned verbatim, never shell-joined and
// never re-parsed. By the time `wrapper.ts` runs, the *original* invoking
// shell (whatever ran `optiflow-chop <command>`) has already tokenized
// quotes/whitespace correctly — that's the property that makes the
// prepend-rewrite safe in the first place (see shell-safety.ts). Passing
// `shell: true` with an args array here would UNDO that: Node's own docs
// (and empirically verified on this machine, see below) confirm `shell:
// true` + an args array does NOT re-quote arguments — it concatenates them
// with spaces, which silently splits `git commit -m "hello world"` into two
// arguments. `spawnSync(cmd, args, { shell: true })` on Node 24 also emits
// DEP0190 for exactly this reason.
//
// EMPIRICAL FINDING THIS MODULE EXISTS TO HANDLE (verified directly on this
// Windows machine, Node v24.15.0, not assumed):
//   - `spawnSync('npm', [...], { shell: false })`      -> ENOENT
//   - `spawnSync('npm.cmd', [...], { shell: false })`  -> EINVAL (Node
//     explicitly refuses to spawn .cmd/.bat files without a shell — this is
//     intentional post-CVE-2024-27980 behavior, not a resolution bug).
// Real `.exe` binaries (git.exe, docker.exe, kubectl.exe, terraform.exe,
// go.exe, and most pip-installed console-script binaries incl. pytest.exe)
// spawn fine with `shell: false` on Windows. Only npm-ecosystem shims
// (npm/npx/jest/vitest when they resolve to a `.cmd`/`.bat` on PATH, which
// is the common case for globally-installed or `node_modules/.bin` tools
// on Windows) hit the EINVAL/ENOENT wall above and need the fallback below.
//
// FALLBACK: build a single, correctly-quoted Windows command-line string
// (`quoteWindowsArg` below, the standard MSVCRT-compatible argv-quoting
// algorithm also used by Python's `subprocess.list2cmdline`) and pass THAT
// single string to `spawnSync(fullCommandLine, { shell: true })` — the
// single-string form of `shell: true` sends the string to `cmd.exe /d /s
// /c` unmodified, so our own quoting is the only quoting that happens.
// Verified end-to-end against `node.exe` with a tricky arg set (embedded
// quote, trailing backslash, embedded space) round-tripping correctly
// through `cmd.exe` back into `process.argv`.
//
// KNOWN LIMITATION: `.cmd`/`.bat` files run their own argument re-splitting
// once inside the batch script (`%*`/`%1`), which has its own, looser
// quoting quirks for characters cmd.exe treats specially (`%`, `^`). Plain
// arguments (paths, flags, package/script names, quoted strings containing
// spaces) round-trip correctly; arguments containing raw `%` or `^` may not.
// This is a documented limitation, not a silent correctness gap: it only
// affects the npm-ecosystem-shim fallback path on Windows, never the direct
// `shell:false` path used by git/docker/kubectl/terraform/go/pytest.exe,
// and never changes exit-code propagation (see wrapper.ts).

import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export interface RunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** Set when the command could not be spawned at all (e.g. truly not found). */
  spawnError?: string;
}

/**
 * Quotes a single argument for a Windows `cmd.exe` command line, using the
 * standard MSVCRT-compatible argv-quoting algorithm (the same one
 * `CommandLineToArgvW`-based programs, incl. `node.exe`, parse back
 * correctly). Leaves arguments with no special characters unquoted.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg === "") return '""';
  if (!/[ \t"\v\n]/.test(arg)) return arg;

  let result = '"';
  for (let i = 0; i < arg.length; ) {
    let backslashes = 0;
    while (i < arg.length && arg[i] === "\\") {
      backslashes++;
      i++;
    }
    if (i === arg.length) {
      // Trailing backslashes: double them (they'd otherwise escape the
      // closing quote we're about to append).
      result += "\\".repeat(backslashes * 2);
      break;
    } else if (arg[i] === '"') {
      result += "\\".repeat(backslashes * 2 + 1) + '"';
      i++;
    } else {
      result += "\\".repeat(backslashes) + arg[i];
      i++;
    }
  }
  result += '"';
  return result;
}

function toStrings(
  buf: SpawnSyncReturns<Buffer>["stdout"] | SpawnSyncReturns<Buffer>["stderr"]
): string {
  if (!buf) return "";
  return Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
}

/**
 * Codes indicating a direct `shell:false` spawn failed specifically because
 * the target needs a shell (a `.cmd`/`.bat` on Windows) — as opposed to
 * genuinely not existing. `ENOENT` is ambiguous (Windows returns it for a
 * bare name with no direct executable match, e.g. `npm` with no `.exe`);
 * `EINVAL` is Windows's explicit "refuses to run a .cmd/.bat without shell"
 * signal. Both trigger the fallback on win32 only.
 */
const WINDOWS_SHELL_FALLBACK_CODES = new Set(["ENOENT", "EINVAL", "UNKNOWN"]);

/**
 * Runs `binary args...` and captures stdout/stderr + exit status, never
 * throwing. On non-Windows, always spawns directly (`shell: false`). On
 * Windows, tries a direct spawn first (fast path — works for genuine `.exe`
 * binaries) and only falls back to the quoted-cmdline `shell: true` path
 * when the direct spawn fails with a code indicating the target needs a
 * shell to run (see `WINDOWS_SHELL_FALLBACK_CODES`).
 */
export function runCommand(binary: string, args: string[]): RunResult {
  const direct = spawnSync(binary, args, { shell: false });

  const directFailedNeedsShell =
    process.platform === "win32" &&
    direct.error !== undefined &&
    "code" in direct.error &&
    WINDOWS_SHELL_FALLBACK_CODES.has(String((direct.error as NodeJS.ErrnoException).code));

  if (!directFailedNeedsShell) {
    if (direct.error && direct.status === null && direct.signal === null) {
      return {
        status: null,
        signal: null,
        stdout: "",
        stderr: "",
        spawnError: direct.error.message,
      };
    }
    return {
      status: direct.status,
      signal: direct.signal,
      stdout: toStrings(direct.stdout),
      stderr: toStrings(direct.stderr),
    };
  }

  // Windows shell fallback: build one correctly-quoted command-line string
  // ourselves (never let Node do naive array-join quoting under
  // `shell:true` — see module header).
  const commandLine = [binary, ...args.map(quoteWindowsArg)].join(" ");
  const viaShell = spawnSync(commandLine, { shell: true });

  if (viaShell.error && viaShell.status === null && viaShell.signal === null) {
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      spawnError: viaShell.error.message,
    };
  }
  return {
    status: viaShell.status,
    signal: viaShell.signal,
    stdout: toStrings(viaShell.stdout),
    stderr: toStrings(viaShell.stderr),
  };
}
