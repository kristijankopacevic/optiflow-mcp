// Environment probes for `optiflow doctor`.
//
// Deliberately does NOT shell out to
// `npx -y @ooples/token-optimizer-mcp@<version> --version` to detect the
// package: ADR 0001 (docs/ADR/0001-provenance-only-submodules.md) already
// proved that neither `--version` nor `--help` is handled by that package —
// it ignores the flag and starts its stdio MCP server instead, so probing it
// that way would hang waiting on stdin. The pin-vs-vendored check below
// instead just compares the configured version string against
// vendor/token-optimizer-mcp/package.json's real `version` field.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import type { OptiflowConfig } from "../config/schema.js";
import { findProjectRoot } from "../core/paths.js";

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

export interface HeadroomPathInfo {
  present: boolean;
}

/** Whether `headroom` is resolvable on PATH (cross-platform which/where). */
export function detectHeadroomOnPath(): HeadroomPathInfo {
  const finder = process.platform === "win32" ? "where" : "which";
  const probe = runCommand(finder, ["headroom"], 5000);
  return { present: probe.ok && probe.stdout.trim().length > 0 };
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

export type TokenOptimizerPinStatus = "match" | "mismatch" | "unknown";

export interface TokenOptimizerPinInfo {
  expectedVersion: string;
  vendoredVersion: string | null;
  vendorPackageJsonPath: string;
  status: TokenOptimizerPinStatus;
}

/**
 * Compares `config.engines.tokenOptimizer.version` against the version
 * actually recorded in the vendored submodule's package.json. "unknown"
 * (not "mismatch") when the submodule isn't present/initialized — this is
 * expected for anyone who installed the plugin without cloning optiflow's
 * own repo with submodules, and isn't itself an error.
 */
export function detectTokenOptimizerPin(
  config: OptiflowConfig,
  options: { cwd?: string } = {}
): TokenOptimizerPinInfo {
  const expectedVersion = config.engines.tokenOptimizer.version;
  const projectRoot = findProjectRoot(options.cwd ?? process.cwd());
  const vendorPackageJsonPath = path.join(
    projectRoot,
    "vendor",
    "token-optimizer-mcp",
    "package.json"
  );

  if (!existsSync(vendorPackageJsonPath)) {
    return {
      expectedVersion,
      vendoredVersion: null,
      vendorPackageJsonPath,
      status: "unknown",
    };
  }

  try {
    const raw = readFileSync(vendorPackageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    const vendoredVersion =
      typeof parsed?.version === "string" ? parsed.version : null;
    return {
      expectedVersion,
      vendoredVersion,
      vendorPackageJsonPath,
      status:
        vendoredVersion === null
          ? "unknown"
          : vendoredVersion === expectedVersion
            ? "match"
            : "mismatch",
    };
  } catch {
    return {
      expectedVersion,
      vendoredVersion: null,
      vendorPackageJsonPath,
      status: "unknown",
    };
  }
}

// ---------------------------------------------------------------------------
// headroom-wrap conflict detection (plan Risk R1).
// ---------------------------------------------------------------------------
//
// Researched from vendor/headroom directly (headroom/cli/wrap.py,
// wiki/persistent-installs.md, wiki/cli.md) rather than guessed:
//
//   - `headroom wrap claude` and `headroom install apply --target claude`
//     both durably write `env.ANTHROPIC_BASE_URL` (and `env.ENABLE_TOOL_SEARCH`)
//     into Claude Code's settings.json so that daemon-spawned conversations
//     inherit the proxy (see vendor/headroom CHANGELOG: "write
//     env.ANTHROPIC_BASE_URL to settings.json so daemon-spawned conversations
//     inherit proxy").
//   - headroom also installs hooks marked with the literal strings
//     `headroom-init-claude` and `headroom-wrap-selfheal`
//     (vendor/headroom/headroom/cli/wrap.py: `_HEADROOM_HOOK_MARKERS`,
//     `_WRAP_SELFHEAL_HOOK_MARKER`) so it can find/remove them again.
//
// LIMITATION (documented, not glossed over): this is a configuration-level
// signal, not a live-process check. `env.ANTHROPIC_BASE_URL` can be left
// behind by a crashed/dead proxy (vendor/headroom's own CHANGELOG has two
// separate fixes titled "detect and clear stale ANTHROPIC_BASE_URL" and
// "self-heal a stale ANTHROPIC_BASE_URL left by a dead proxy"), so a positive
// result here means "Claude Code is currently configured to route through a
// headroom proxy," not "a headroom proxy is currently running." optiflow
// doctor reports it as exactly that — a configuration warning — and does not
// attempt to probe whether the proxy is actually alive (no reliable
// cross-platform signal for that was found in vendor/headroom's docs).
// There is also no `headroom unwrap claude` command (only `headroom unwrap
// openclaw` exists per vendor/headroom/wiki/cli.md) — recovery is manual
// removal of the env keys/hook entries below.

const HEADROOM_ENV_KEYS = ["ANTHROPIC_BASE_URL", "ENABLE_TOOL_SEARCH"] as const;
const HEADROOM_HOOK_MARKERS = ["headroom-init-claude", "headroom-wrap-selfheal"] as const;

export interface HeadroomWrapSignal {
  filePath: string;
  envKeysFound: string[];
  hookMarkersFound: string[];
}

export interface HeadroomWrapInfo {
  wrapped: boolean;
  signals: HeadroomWrapSignal[];
}

function inspectClaudeSettingsFile(filePath: string): HeadroomWrapSignal | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const env =
      parsed && typeof parsed === "object" && parsed.env && typeof parsed.env === "object"
        ? (parsed.env as Record<string, unknown>)
        : {};
    const envKeysFound = HEADROOM_ENV_KEYS.filter(
      (key) => env[key] !== undefined && env[key] !== null && env[key] !== ""
    );

    // Cheap and robust: search the whole serialized settings file for the
    // marker strings rather than hand-modeling Claude Code's hooks schema.
    const wholeFile = JSON.stringify(parsed);
    const hookMarkersFound = HEADROOM_HOOK_MARKERS.filter((marker) =>
      wholeFile.includes(marker)
    );

    if (envKeysFound.length === 0 && hookMarkersFound.length === 0) return null;
    return { filePath, envKeysFound, hookMarkersFound };
  } catch {
    return null;
  }
}

/**
 * Checks user-global and project-level Claude Code settings files for signs
 * that `headroom wrap`/`headroom install apply` has durably configured
 * Claude Code to route through a headroom proxy. Best-effort — see the
 * limitation note above the interfaces in this section.
 */
export function detectHeadroomWrap(
  options: { cwd?: string; home?: string } = {}
): HeadroomWrapInfo {
  const projectRoot = findProjectRoot(options.cwd ?? process.cwd());
  const home = options.home ?? homedir();
  const candidatePaths = [
    path.join(home, ".claude", "settings.json"),
    path.join(projectRoot, ".claude", "settings.json"),
    path.join(projectRoot, ".claude", "settings.local.json"),
  ];

  const signals = candidatePaths
    .map(inspectClaudeSettingsFile)
    .filter((signal): signal is HeadroomWrapSignal => signal !== null);

  return { wrapped: signals.length > 0, signals };
}
