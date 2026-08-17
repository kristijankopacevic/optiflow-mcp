import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettingsFile, setOptiflowStatusLine } from "../../install/settings-writer.js";
import { runInstallCli } from "./install.js";
import { runUninstallCli } from "./uninstall.js";

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-uninstall-home-test-"));
  cwd = mkdtempSync(path.join(tmpdir(), "optiflow-uninstall-cwd-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function settingsPath(): string {
  return path.join(home, ".claude", "settings.json");
}

function writeExistingSettings(value: unknown): void {
  mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(value), "utf8");
}

describe("runUninstallCli", () => {
  it("reports nothing to do when settings.json doesn't exist at all", () => {
    const result = runUninstallCli({ cwd, home, settingsPath: settingsPath() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/nothing to do/);
  });

  it("reports nothing to do when settings.json exists but has no statusLine", () => {
    writeExistingSettings({ other: "value" });
    const result = runUninstallCli({ cwd, home, settingsPath: settingsPath() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/nothing to do/);
    expect(readSettingsFile(settingsPath())).toEqual({ other: "value" });
  });

  it("restores the whole file from backup after install activated it on a machine with a prior settings.json", () => {
    writeExistingSettings({ prior: "config", other: 1 });
    const install = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });
    expect(install.exitCode).toBe(0);
    expect(readSettingsFile(settingsPath()).statusLine).toBeDefined();

    const result = runUninstallCli({ cwd, home, settingsPath: settingsPath() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/restored .* from backup/);
    expect(readSettingsFile(settingsPath())).toEqual({ prior: "config", other: 1 });
  });

  it("removes the key (no restore) when install activated it on a fresh machine with no prior settings.json", () => {
    const install = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });
    expect(install.exitCode).toBe(0);

    const result = runUninstallCli({ cwd, home, settingsPath: settingsPath() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/removed the statusLine key/);
    expect(readSettingsFile(settingsPath())).toEqual({});
  });

  it("refuses without --force when the current statusLine no longer looks like optiflow's own", () => {
    // Install, then simulate the user reconfiguring statusLine afterward.
    setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs");
    writeExistingSettings({ statusLine: { type: "command", command: "users-new-script.mjs" } });

    const result = runUninstallCli({ cwd, home, settingsPath: settingsPath() });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/REFUSED/);
    expect(readSettingsFile(settingsPath()).statusLine).toEqual({
      type: "command",
      command: "users-new-script.mjs",
    });
  });

  it("regression: running `optiflow uninstall` twice does not re-activate the statusline", () => {
    writeExistingSettings({ prior: "config" });
    const install = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });
    expect(install.exitCode).toBe(0);

    const first = runUninstallCli({ cwd, home, settingsPath: settingsPath() });
    expect(first.exitCode).toBe(0);
    expect(readSettingsFile(settingsPath())).toEqual({ prior: "config" });

    const second = runUninstallCli({ cwd, home, settingsPath: settingsPath() });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toMatch(/nothing to do/);
    expect(readSettingsFile(settingsPath())).toEqual({ prior: "config" });
  });

  it("proceeds with --force over a foreign statusLine", () => {
    writeExistingSettings({ statusLine: { type: "command", command: "users-new-script.mjs" } });
    const result = runUninstallCli({ cwd, home, settingsPath: settingsPath(), force: true });
    expect(result.exitCode).toBe(0);
    expect(readSettingsFile(settingsPath()).statusLine).toBeUndefined();
  });

  it("does not delete .optiflow/ data by default", () => {
    writeExistingSettings({ other: 1 });
    process.env.OPTIFLOW_HOME = path.join(home, ".optiflow-home");
    mkdirSync(process.env.OPTIFLOW_HOME, { recursive: true });
    writeFileSync(path.join(process.env.OPTIFLOW_HOME, "ledger.jsonl"), "{}\n", "utf8");

    try {
      const result = runUninstallCli({ cwd, home, settingsPath: settingsPath() });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/left in place/);
      expect(existsSync(path.join(process.env.OPTIFLOW_HOME, "ledger.jsonl"))).toBe(true);
    } finally {
      delete process.env.OPTIFLOW_HOME;
    }
  });

  it("--purge deletes ledger/logs/activity and project-local .optiflow/, keeping config.json", () => {
    process.env.OPTIFLOW_HOME = path.join(home, ".optiflow-home");
    mkdirSync(process.env.OPTIFLOW_HOME, { recursive: true });
    writeFileSync(path.join(process.env.OPTIFLOW_HOME, "ledger.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(process.env.OPTIFLOW_HOME, "config.json"), "{}\n", "utf8");
    mkdirSync(path.join(process.env.OPTIFLOW_HOME, "logs"), { recursive: true });
    mkdirSync(path.join(cwd, ".git"), { recursive: true });
    mkdirSync(path.join(cwd, ".optiflow", "checkpoints"), { recursive: true });
    writeFileSync(path.join(cwd, ".optiflow", "checkpoints", "x.json"), "{}", "utf8");

    try {
      const result = runUninstallCli({ cwd, home, settingsPath: settingsPath(), purge: true });
      expect(result.exitCode).toBe(0);
      expect(existsSync(path.join(process.env.OPTIFLOW_HOME, "ledger.jsonl"))).toBe(false);
      expect(existsSync(path.join(process.env.OPTIFLOW_HOME, "logs"))).toBe(false);
      expect(existsSync(path.join(process.env.OPTIFLOW_HOME, "config.json"))).toBe(true);
      expect(existsSync(path.join(cwd, ".optiflow"))).toBe(false);
    } finally {
      delete process.env.OPTIFLOW_HOME;
    }
  });
});
