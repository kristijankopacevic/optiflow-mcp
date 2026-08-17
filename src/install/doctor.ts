// Composes install/detect.ts probes into a human-readable environment
// report. This module only *reports* — refusing to proceed on a
// headroom-wrap conflict (plan Risk R1) is `install.ts`'s job in a later
// phase, not doctor's.

import { loadConfig, type LoadedConfig } from "../config/load.js";
import {
  detectGhAuth,
  detectHeadroomOnPath,
  detectHeadroomWrap,
  detectNodeEnv,
  detectTokenOptimizerPin,
  type GhAuthInfo,
  type HeadroomPathInfo,
  type HeadroomWrapInfo,
  type NodeEnvInfo,
  type TokenOptimizerPinInfo,
} from "./detect.js";

export interface DoctorReport {
  node: NodeEnvInfo;
  configLoad: LoadedConfig;
  tokenOptimizerPin: TokenOptimizerPinInfo;
  headroomOnPath: HeadroomPathInfo;
  headroomWrap: HeadroomWrapInfo;
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
    tokenOptimizerPin: detectTokenOptimizerPin(configLoad.config, {
      cwd: options.cwd,
    }),
    headroomOnPath: detectHeadroomOnPath(),
    headroomWrap: detectHeadroomWrap({ cwd: options.cwd, home: options.home }),
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

  lines.push("token-optimizer-mcp");
  lines.push(statusLine("Configured pin", report.tokenOptimizerPin.expectedVersion));
  const pinStatusLabel =
    report.tokenOptimizerPin.status === "match"
      ? `match (vendored: ${report.tokenOptimizerPin.vendoredVersion})`
      : report.tokenOptimizerPin.status === "mismatch"
        ? `MISMATCH (vendored: ${report.tokenOptimizerPin.vendoredVersion})`
        : "unknown (vendor/token-optimizer-mcp/package.json not found — submodule not initialized?)";
  lines.push(statusLine("Vendored submodule pin", pinStatusLabel));
  lines.push("");

  lines.push("headroom");
  lines.push(
    statusLine(
      "On PATH",
      report.headroomOnPath.present ? "yes" : "no (optional — features degrade gracefully)"
    )
  );
  if (report.headroomWrap.wrapped) {
    lines.push(
      statusLine(
        "Wrap conflict (Risk R1)",
        "WARNING — Claude Code appears configured to route through a headroom proxy"
      )
    );
    for (const signal of report.headroomWrap.signals) {
      const parts: string[] = [];
      if (signal.envKeysFound.length > 0) {
        parts.push(`env keys: ${signal.envKeysFound.join(", ")}`);
      }
      if (signal.hookMarkersFound.length > 0) {
        parts.push(`hook markers: ${signal.hookMarkersFound.join(", ")}`);
      }
      lines.push(`      - ${signal.filePath} (${parts.join("; ")})`);
    }
    lines.push(
      "      This is a configuration-level signal, not a live-process check — a"
    );
    lines.push(
      "      dead proxy can leave this behind. There is no `headroom unwrap claude`"
    );
    lines.push(
      "      command; recovery is manually removing env.ANTHROPIC_BASE_URL /"
    );
    lines.push(
      "      env.ENABLE_TOOL_SEARCH and any headroom-marked hook entries from the"
    );
    lines.push("      settings file(s) listed above.");
  } else {
    lines.push(statusLine("Wrap conflict (Risk R1)", "none detected"));
  }
  lines.push("");

  lines.push("GitHub CLI");
  lines.push(statusLine("gh present", report.gh.present ? "yes" : "no"));
  if (report.gh.present) {
    lines.push(statusLine("gh authenticated", ghAuthenticatedLabel(report.gh.authenticated)));
  }

  return lines.join("\n");
}
