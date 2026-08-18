// Composes install/detect.ts probes into a human-readable environment
// report.
//
// v2 cleanup: this used to also report a token-optimizer version-pin-vs-
// vendored-submodule check, an "upstream invariant" scan (plan Risk R9),
// headroom-on-PATH presence, and a headroom-wrap conflict warning (plan
// Risk R1). All four are gone as of v2's real merge — see detect.ts's own
// header for exactly why each one no longer applies. `optiflow doctor` is
// intentionally shorter now, not less thorough: there is genuinely less to
// check once there's no separate vendored process or binary in the picture.

import { loadConfig, type LoadedConfig } from "../config/load.js";
import { detectGhAuth, detectNodeEnv, type GhAuthInfo, type NodeEnvInfo } from "./detect.js";

export interface DoctorReport {
  node: NodeEnvInfo;
  configLoad: LoadedConfig;
  gh: GhAuthInfo;
}

export interface RunDoctorOptions {
  cwd?: string;
  home?: string;
}

export function runDoctor(options: RunDoctorOptions = {}): DoctorReport {
  const configLoad = loadConfig({ cwd: options.cwd, home: options.home });
  return {
    node: detectNodeEnv(),
    configLoad,
    gh: detectGhAuth(),
  };
}

function statusLine(label: string, value: string): string {
  return `  ${label.padEnd(28, " ")} ${value}`;
}

function ghAuthenticatedLabel(authenticated: boolean | "unknown"): string {
  if (authenticated === "unknown") return "unknown (probe timed out)";
  return authenticated ? "yes" : "no";
}

/** Renders a `DoctorReport` as the human-readable table `optiflow doctor` prints. */
export function renderDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("optiflow doctor");
  lines.push("================");
  lines.push("");

  lines.push("Runtime");
  lines.push(statusLine("Node version", report.node.nodeVersion));
  lines.push(
    statusLine("npm version", report.node.npmVersion ?? "not found / probe failed")
  );
  lines.push("");

  lines.push("Config resolution");
  lines.push(
    statusLine(
      "User-global config",
      report.configLoad.sources.userGlobal ?? "(not found — using defaults)"
    )
  );
  lines.push(
    statusLine(
      "Project config",
      report.configLoad.sources.project ?? "(not found — using defaults)"
    )
  );
  lines.push(
    statusLine(
      "Validation",
      report.configLoad.usedFallback
        ? "FAILED — fell back to defaults (see stderr warning)"
        : "ok"
    )
  );
  lines.push(
    statusLine("chop.enabled (resolved)", String(report.configLoad.config.chop.enabled))
  );
  lines.push("");

  lines.push("GitHub CLI");
  lines.push(statusLine("gh present", report.gh.present ? "yes" : "no"));
  if (report.gh.present) {
    lines.push(statusLine("gh authenticated", ghAuthenticatedLabel(report.gh.authenticated)));
  }

  return lines.join("\n");
}
