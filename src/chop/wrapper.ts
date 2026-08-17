// The `optiflow-chop` runtime process entry point: what `optiflow-chop
// <command...>` actually does when the PreToolUse hook's rewritten command
// runs. All the actual logic (spawning, filtering, ledger recording, the
// exit-code/stderr contract) lives in `wrapper-core.ts`'s `runWrapper` —
// this file is deliberately thin and UNCONDITIONALLY self-executing.
//
// UNCONDITIONAL, not import.meta-guarded (unlike pretooluse.ts/
// posttooluse-mcp.ts): this module is never invoked directly by `node
// <this-file>` the way the hook entries are (per hooks.json, `node
// ".../pretooluse-chop.mjs"` runs that file itself, so `process.argv[1]`
// matches its own URL and an import.meta-based guard works there). This
// file is instead reached only via `plugin/bin/optiflow-chop`'s `import
// "../dist/chop/wrapper.js"` — under that invocation, `process.argv[1]` is
// the *bin shim's* path, not this bundled module's, so an import.meta/
// argv[1] equality guard would always evaluate false and `main()` would
// silently never run (confirmed empirically during manual verification: a
// guarded version of this file produced empty stdout / silent no-op exit 0
// for every real `optiflow-chop <cmd>` invocation). This matches the
// existing `src/cli/index.ts` pattern (also reached only via a `bin/`
// shim's `import`, also unconditional). `runWrapper` itself lives in the
// separate `wrapper-core.ts` module specifically so tests can import it
// without ever triggering this file's unconditional `main()`.

import { runWrapper } from "./wrapper-core.js";

async function main(): Promise<void> {
  const [binary, ...args] = process.argv.slice(2);
  if (!binary) {
    process.stderr.write("optiflow-chop: no command given\n");
    process.exitCode = 2;
    return;
  }

  let minOutputBytes = 0;
  try {
    const { loadConfig } = await import("../config/load.js");
    minOutputBytes = loadConfig().config.chop.minOutputBytes;
  } catch {
    // Config load failing must never block running the wrapped command.
  }

  const result = runWrapper(binary, args, { minOutputBytes });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

main();
