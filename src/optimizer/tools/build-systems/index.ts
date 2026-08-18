/**
 * Build Systems Tools - Cross-Platform CLI Invocation, Test/Lint/Build
 * Wrappers, and System/Process/Network Diagnostics
 *
 * All 10 tools below (smart_build, smart_docker, smart_install, smart_lint,
 * smart_logs, smart_network, smart_processes, smart_system_metrics,
 * smart_test, smart_typecheck) are real, compiling code with a genuine
 * `get*(cache, ...)` factory and a real dispatch case in vendor's own
 * `src/server/index.ts` (`case 'smart_xxx': { const options = args as any;
 * const result = await smartXxx.run(options); ... }` -- whole-args-object,
 * no positional destructuring, for every tool in this category). Vendor's
 * OWN category `index.ts` only re-exports 5 of these 10 (smart_test,
 * smart_build, smart_lint, smart_typecheck, smart_processes) -- the other 5
 * (smart_docker, smart_install, smart_logs, smart_network,
 * smart_system_metrics) are real, dispatched tools that vendor's own barrel
 * simply never re-exported (an oversight, not a stub marker -- cross-checked
 * against vendor's real `src/server/index.ts` dispatch, which has a case
 * for every one of the 10). None of the 10 carry the "Implementation
 * pending" fixed-string stub pattern seen elsewhere in this merge (e.g.
 * ../intelligence/index.ts).
 *
 * WINDOWS CVE-2024-27980 WORKAROUND: `run-node-bin.ts`'s `spawnNodeBin`/
 * `spawnNpm` helpers already existed in this vendored fork (pre-copied ahead
 * of this checkpoint) specifically because Node 20.12+ refuses to spawn a
 * `.cmd`/`.bat` shim with `shell: false`. Five of these ten tools already
 * used that helper before this checkpoint touched them:
 *   - smart_build, smart_lint, smart_typecheck: `spawnNodeBin('typescript',
 *     'tsc', ...)` / `spawnNodeBin('eslint', 'eslint', ...)`.
 *   - smart_install: `spawnNpm(...)` for npm, `spawnNodeBin(pm, pm, ...)`
 *     for yarn/pnpm.
 *   - smart_test: `spawnNpm(['run', 'test', ...])`.
 * The other five spawn real OS executables (`docker`, `ping`, `wmic`,
 * `powershell`, `journalctl`, `ps`) that are native binaries on every
 * platform (never a `.cmd`/`.bat` shim on Windows), so the CVE fix never
 * applies to them and no workaround was needed -- confirmed by reading each
 * spawn call site directly (smart-docker.ts, smart-network.ts,
 * smart-system-metrics.ts use raw `child_process.spawn(...)`;
 * smart-processes.ts and smart-logs.ts use the already-merged
 * `utils/safe-exec.ts` `execFileSafe`/`spawnSafe` argv-mode helpers instead,
 * for the same "no shell, no injection" property against a different class
 * of command). `docker.exe` was confirmed present as a real `.exe` (not
 * `.cmd`) on this dev machine.
 *
 * FIXED DURING COORDINATOR REVIEW: `smart_build`, `smart_lint`,
 * `smart_typecheck`, and `smart_test` already carried an explicit vendor
 * comment ("Honor a per-call projectRoot...") and re-read
 * `options.projectRoot` at the top of `run()` every call, because
 * `createOptimizerRuntime()` constructs every tool ONCE as a shared
 * singleton at server start. `smart_install`, `smart_docker`, and
 * `smart_logs` did NOT have that fix when first merged — they set
 * `this.projectRoot` only in the constructor, so a per-call `projectRoot`
 * argument was silently ignored once the MCP server was running (always
 * operating on the server process's own `cwd` instead). The same
 * `defaultProjectRoot` + re-read-at-top-of-`run()` pattern has now been
 * applied to all three, mirroring the other four tools exactly. Separately,
 * `smart_network`, `smart_system_metrics`, and `smart_processes` accept a
 * `projectRoot` constructor/schema field that is entirely unused by the
 * class body (`_projectRoot`, prefixed to mark it dead) -- not a staleness
 * bug, just an advertised-but-inert option, since ping/DNS/port-scan/disk/
 * process-listing operations aren't tied to a project directory in this
 * design; left as-is.
 *
 * TYPE-NAME COLLISIONS: none. Every exported class/interface/type/const
 * across all 12 files in this category (10 tools + the two shared helpers
 * below) has a distinct name -- verified by grepping every top-level
 * `export` in the category (unlike ../api-database/index.ts, which needed
 * aliased re-exports for four real collisions).
 *
 * test-frameworks.ts (Jest/Vitest/Mocha/node --test/AVA detection and
 * report normalisation, used by smart-test.ts) and wmic-process-parser.ts
 * (WMIC CSV -> ProcessInfo parsing, used by smart-processes.ts) are shared
 * helper modules, not tools themselves -- re-exported here for the same
 * reason run-node-bin.ts already was.
 */

export * from './run-node-bin.js';
export * from './test-frameworks.js';
export * from './wmic-process-parser.js';

export {
  SmartBuild,
  getSmartBuildTool,
  runSmartBuild,
  SMART_BUILD_TOOL_DEFINITION,
} from './smart-build.js';
export {
  SmartDocker,
  getSmartDocker,
  runSmartDocker,
  SMART_DOCKER_TOOL_DEFINITION,
} from './smart-docker.js';
export {
  SmartInstall,
  getSmartInstall,
  runSmartInstall,
  SMART_INSTALL_TOOL_DEFINITION,
} from './smart-install.js';
export {
  SmartLint,
  getSmartLintTool,
  runSmartLint,
  SMART_LINT_TOOL_DEFINITION,
} from './smart-lint.js';
export {
  SmartLogs,
  getSmartLogs,
  runSmartLogs,
  SMART_LOGS_TOOL_DEFINITION,
} from './smart-logs.js';
export {
  SmartNetwork,
  getSmartNetwork,
  runSmartNetwork,
  SMART_NETWORK_TOOL_DEFINITION,
} from './smart-network.js';
export {
  SmartProcesses,
  getSmartProcessesTool,
  runSmartProcesses,
  SMART_PROCESSES_TOOL_DEFINITION,
} from './smart-processes.js';
export {
  SmartSystemMetrics,
  getSmartSystemMetrics,
  runSmartSystemMetrics,
  SMART_SYSTEM_METRICS_TOOL_DEFINITION,
} from './smart-system-metrics.js';
export {
  SmartTest,
  getSmartTestTool,
  runSmartTest,
  SMART_TEST_TOOL_DEFINITION,
} from './smart-test.js';
export {
  SmartTypeCheck,
  getSmartTypeCheckTool,
  runSmartTypeCheck,
  SMART_TYPECHECK_TOOL_DEFINITION,
} from './smart-typecheck.js';
