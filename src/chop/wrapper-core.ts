// The testable core of the `optiflow-chop` runtime. Deliberately has ZERO
// self-executing top-level side effects (no `main()`, no process.argv
// reads) — `src/chop/wrapper.ts` is the thin, self-executing process entry
// point that imports `runWrapper` from here; this split exists specifically
// so `wrapper.test.ts` can import `runWrapper` without triggering a real
// spawn of `process.argv.slice(2)` (which, for a test runner's own argv,
// would be nonsensical and would corrupt the test process's own exit code).
//
// EXIT CODE / STDERR CONTRACT (documented per the task's explicit request):
//   - The real exit code is ALWAYS propagated via `process.exitCode` by the
//     caller in `wrapper.ts`, never via `process.exit()` — `process.exit()`
//     can truncate stdout that is still draining asynchronously to a pipe
//     (this matters most on Windows). A signal-terminated child (`status
//     === null`, `signal` set) maps to exit code 1 here (Node has no
//     portable way to "re-signal" itself identically cross-platform; 1
//     preserves "this failed" without lying about which signal).
//   - On a NON-ZERO exit code, stdout is passed through UNFILTERED (only
//     capped for size, never compressed): compressing a failure's output
//     risks destroying the exact diagnostic detail an agent needs to fix
//     the problem. `testrunner.ts` is a deliberate exception — for test
//     runners (jest/vitest/pytest/`go test`), the filtered output — pass/
//     fail counts + only the failing detail — already IS the failure
//     diagnostic, not a discard of it, so those binaries are always
//     eligible for filtering regardless of exit code.
//   - stderr is NEVER filtered — it is passed through verbatim (still
//     capped for size). Every filter in this module is tuned for the
//     specific structured shape of a tool's STDOUT; running one on stderr
//     risks eating an error message its heuristics don't expect.

import { appendLedger } from "../core/ledger.js";
import { countTokens } from "../core/tokens.js";
import { getFilterForBinary } from "./filters/index.js";
import { annotateCcrMarkers } from "./filters/generic.js";
import { runCommand } from "./win-spawn.js";

/** Output over this many bytes gets hard-capped (not just filtered) to avoid pathological hook-output sizes. */
const MAX_PASSTHROUGH_BYTES = 200_000;

const TEST_RUNNER_BINARIES = new Set(["jest", "vitest", "pytest", "go"]);

export interface WrapperResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function capBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  // Slicing by JS string length is a close enough approximation of a byte
  // cap for this purpose (a hard safety net, not a precise budget) and
  // never risks slicing a multi-byte UTF-8 sequence mid-codepoint the way
  // slicing a Buffer at an arbitrary byte offset could.
  let sliced = text.slice(0, maxBytes);
  while (Buffer.byteLength(sliced, "utf8") > maxBytes && sliced.length > 0) {
    sliced = sliced.slice(0, sliced.length - 1);
  }
  return sliced + `\n... [output capped at ${maxBytes} bytes] ...\n`;
}

export interface RunWrapperOptions {
  /** Injectable for tests; defaults to the real spawn implementation. */
  run?: typeof runCommand;
  /** Injectable for tests; defaults to the real ledger writer. */
  writeLedger?: typeof appendLedger;
  minOutputBytes?: number;
}

/**
 * Runs `binary args...`, filters its output, records a ledger entry, and
 * returns the result. Never throws (a spawn failure is reported through
 * `WrapperResult`, not an exception) and never touches `process.exit`/
 * `process.exitCode` itself — the caller (`wrapper.ts`'s `main()`) owns
 * translating `WrapperResult` into real process stdout/stderr/exit code.
 */
export function runWrapper(
  binary: string,
  args: string[],
  options: RunWrapperOptions = {}
): WrapperResult {
  const run = options.run ?? runCommand;
  const writeLedger = options.writeLedger ?? appendLedger;
  const minOutputBytes = options.minOutputBytes ?? 0;

  const result = run(binary, args);

  if (result.spawnError) {
    // Could not spawn at all (binary genuinely missing): report as a
    // failure via stderr + a conventional "command not found" exit code,
    // never throw, never silently claim success.
    return {
      exitCode: 127,
      stdout: "",
      stderr: `optiflow-chop: failed to run '${binary}': ${result.spawnError}\n`,
    };
  }

  const exitCode = result.status !== null ? result.status : 1; // signal-terminated -> 1, see module header
  const bytesBefore = Buffer.byteLength(result.stdout, "utf8");
  const tokensBefore = countTokens(result.stdout);

  const isTestRunner = TEST_RUNNER_BINARIES.has(binary);
  const shouldFilterOutput = isTestRunner
    ? bytesBefore >= minOutputBytes || exitCode !== 0
    : exitCode === 0 && bytesBefore >= minOutputBytes;

  let outStdout = result.stdout;
  if (shouldFilterOutput) {
    const filter = getFilterForBinary(binary);
    const filtered = filter({ stdout: result.stdout, stderr: result.stderr, args, exitCode });
    // The second of the two boundaries where filtered text becomes model
    // context (the other is src/chop/posttooluse-mcp.ts). A `<<ccr:HASH>>`
    // marker is unusable unless something names the tool that resolves it,
    // and this is a no-op when no marker is present.
    outStdout = annotateCcrMarkers(filtered.text);
  }

  outStdout = capBytes(outStdout, MAX_PASSTHROUGH_BYTES);
  const outStderr = capBytes(result.stderr, MAX_PASSTHROUGH_BYTES);

  const bytesAfter = Buffer.byteLength(outStdout, "utf8");
  const tokensAfter = countTokens(outStdout);

  writeLedger({
    module: "chop",
    command_or_context: [binary, ...args].join(" "),
    tokensBefore,
    tokensAfter,
    bytesBefore,
    bytesAfter,
  });

  return { exitCode, stdout: outStdout, stderr: outStderr };
}
