import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettingsFile } from "../../install/settings-writer.js";
import { runInstallCli } from "./install.js";

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-install-home-test-"));
  cwd = mkdtempSync(path.join(tmpdir(), "optiflow-install-cwd-test-"));
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

describe("runInstallCli — default (no --statusline/--no-statusline)", () => {
  it("touches nothing and prints the manual-setup pointer", () => {
    const result = runInstallCli({ cwd, home, settingsPath: settingsPath() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/not touched/);
    expect(result.stdout).toMatch(/statusline-manual-setup\.md/);
    expect(readSettingsFile(settingsPath())).toEqual({});
  });
});

describe("runInstallCli — --statusline", () => {
  it("writes fresh when there's no prior settings.json (backup skipped)", () => {
    const result = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/activated/);
    expect(result.stdout).toMatch(/nothing to back up/);
    expect(readSettingsFile(settingsPath()).statusLine).toEqual({
      type: "command",
      command: 'node "/abs/plugin/scripts/statusline.mjs"',
      padding: 0,
    });
  });

  it("backs up an existing settings.json before writing, preserving unrelated keys", () => {
    writeExistingSettings({ unrelated: "keep-me" });

    const result = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Backed up previous settings/);
    const after = readSettingsFile(settingsPath());
    expect(after.unrelated).toBe("keep-me");
    expect(after.statusLine).toBeDefined();
  });

  it("refuses (non-zero exit) when a different statusLine already exists, without --force", () => {
    writeExistingSettings({ statusLine: { type: "command", command: "someone-elses.mjs" } });

    const result = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/REFUSED/);
    expect(readSettingsFile(settingsPath()).statusLine).toEqual({
      type: "command",
      command: "someone-elses.mjs",
    });
  });

  it("overwrites with --force, backing up the original first", () => {
    writeExistingSettings({ statusLine: { type: "command", command: "someone-elses.mjs" } });

    const result = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      force: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Backed up previous settings/);
    expect(readSettingsFile(settingsPath()).statusLine).not.toEqual({
      type: "command",
      command: "someone-elses.mjs",
    });
  });
});

describe("runInstallCli — --no-statusline", () => {
  it("skips activation explicitly and touches nothing", () => {
    const result = runInstallCli({ cwd, home, settingsPath: settingsPath(), noStatusline: true });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/skipped \(--no-statusline\)/);
    expect(readSettingsFile(settingsPath())).toEqual({});
  });
});

describe("runInstallCli — headroom-wrap refusal (Risk R1)", () => {
  it("refuses when detect.ts's headroom-wrap signal fires, without writing anything", () => {
    writeExistingSettings({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1234" } });

    const result = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/REFUSED/);
    expect(result.stderr).toMatch(/Risk R1/);
    // Nothing was written — statusLine was never even attempted.
    expect(readSettingsFile(settingsPath()).statusLine).toBeUndefined();
  });

  it("proceeds when --allow-headroom-wrap is passed", () => {
    writeExistingSettings({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1234" } });

    const result = runInstallCli({
      cwd,
      home,
      settingsPath: settingsPath(),
      statusline: true,
      allowHeadroomWrap: true,
      scriptPath: "/abs/plugin/scripts/statusline.mjs",
    });

    expect(result.exitCode).toBe(0);
    expect(readSettingsFile(settingsPath()).statusLine).toBeDefined();
  });
});
