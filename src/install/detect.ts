// Environment probes for `optiflow doctor`.
//
// v2 cleanup: this file used to also probe token-optimizer-mcp's vendored
// submodule (pin-vs-vendored version comparison), scan it for an
// `updatedInput` regression (plan Risk R9), check for a separate `headroom`
// binary on PATH, and refuse to install on a detected headroom-wrap
// conflict (plan Risk R1). All four are gone (not "kept but broken") as of
// v2's real merge (docs/ADR/0002-real-merge-not-orchestration.md):
// token-optimizer-mcp's source is copied into src/optimizer/ (no version
// pin, no vendored submodule to drift), the R9 invariant is now a real unit
// test (src/chop/bash-hook-field-disjointness.test.ts) run against this
// repo's own two hooks instead of scanning a vendored one, and headroom's
// compression runs in-process via WASM/TS ports — there is no separate
// `headroom` binary or proxy this plugin invokes anymore, so a user's own,
// independently-wrapped headroom proxy (if any) has nothing of ours to
// conflict with.

import { spawnSync } from "node:child_process";

export interface CommandProbeResult {
  ok: boolean;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs = 5000
): CommandProbeResult {
  try {
    const useShell = process.platform === "win32";
    // Node's DEP0190 warns whenever `args` is non-empty alongside
    // `shell: true` (args aren't escaped by the shell). Every caller here
    // passes fixed literal args with no spaces/metacharacters (probe names
    // like "--version", "auth", "status", "headroom"), so folding them into
    // a single command string ourselves is safe and avoids that warning
    // without losing Windows .cmd-shim resolution (npm, gh, where all need
    // shell:true to resolve on Windows).
    const res = spawnSync(useShell ? [cmd, ...args].join(" ") : cmd, useShell ? [] : args, {
      timeout: timeoutMs,
      encoding: "utf8",
      windowsHide: true,
      shell: useShell,
    });
    const timedOut =
      res.signal === "SIGTERM" ||
      (res.error != null && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT");
    if (res.error && !timedOut) {
      return { ok: false, timedOut: false, stdout: "", stderr: String(res.error.message) };
    }
    return {
      ok: res.status === 0,
      timedOut,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  } catch (err) {
    return { ok: false, timedOut: false, stdout: "", stderr: String(err) };
  }
}

export interface NodeEnvInfo {
  nodeVersion: string;
  npmVersion: string | null;
}

/** Node/npm versions. npm is probed via a short-lived child process. */
export function detectNodeEnv(): NodeEnvInfo {
  const npmProbe = runCommand("npm", ["--version"], 5000);
  return {
    nodeVersion: process.version,
    npmVersion: npmProbe.ok ? npmProbe.stdout.trim() : null,
  };
}

export interface GhAuthInfo {
  present: boolean;
  /** "unknown" when the probe timed out rather than definitively failing. */
  authenticated: boolean | "unknown";
}

/** Whether `gh` is on PATH, and whether `gh auth status` reports logged in. */
export function detectGhAuth(): GhAuthInfo {
  const finder = process.platform === "win32" ? "where" : "which";
  const presence = runCommand(finder, ["gh"], 5000);
  if (!presence.ok) {
    return { present: false, authenticated: false };
  }
  const authProbe = runCommand("gh", ["auth", "status"], 5000);
  if (authProbe.timedOut) {
    return { present: true, authenticated: "unknown" };
  }
  return { present: true, authenticated: authProbe.ok };
}
