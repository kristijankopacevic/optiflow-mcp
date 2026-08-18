import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./defaults.js";
import { loadConfig } from "./load.js";

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-project-test-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-home-test-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("falls back to pure defaults when no config files exist", () => {
    const { config, sources, usedFallback } = loadConfig({ cwd: projectDir, home: homeDir });
    expect(usedFallback).toBe(false);
    expect(sources.userGlobal).toBeNull();
    expect(sources.project).toBeNull();
    expect(config.chop.enabled).toBe(false);
    expect(config.toon.minSavingsPercent).toBe(DEFAULT_CONFIG.toon.minSavingsPercent);
  });

  it("merges user-global config over defaults", () => {
    writeFileSync(
      path.join(homeDir, "config.json"),
      JSON.stringify({ telemetry: { enabled: true } }),
      "utf8"
    );

    const { config, sources } = loadConfig({ cwd: projectDir, home: homeDir });
    expect(sources.userGlobal).not.toBeNull();
    expect(config.telemetry.enabled).toBe(true);
    // Untouched sections still come from defaults.
    expect(config.chop.enabled).toBe(false);
  });

  it("project config wins over user-global config, key-by-key", () => {
    writeFileSync(
      path.join(homeDir, "config.json"),
      JSON.stringify({ toon: { enabled: false, minSavingsPercent: 10 } }),
      "utf8"
    );
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ toon: { minSavingsPercent: 55 } }),
      "utf8"
    );

    const { config } = loadConfig({ cwd: projectDir, home: homeDir });
    // Project overrides minSavingsPercent...
    expect(config.toon.minSavingsPercent).toBe(55);
    // ...but the section-level merge means enabled still comes from the
    // user-global layer since the project layer didn't mention it.
    expect(config.toon.enabled).toBe(false);
  });

  it("chop.enabled stays false by default even when a project config exists", () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ report: { includeOptimizer: true } }),
      "utf8"
    );

    const { config } = loadConfig({ cwd: projectDir, home: homeDir });
    expect(config.chop.enabled).toBe(false);
  });

  it("a project config can explicitly opt in to chop.enabled", () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ chop: { enabled: true } }),
      "utf8"
    );

    const { config } = loadConfig({ cwd: projectDir, home: homeDir });
    expect(config.chop.enabled).toBe(true);
  });

  it("falls back to defaults and warns on stderr when validation fails", () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ chop: { enabled: "yes-please" } }),
      "utf8"
    );

    const stderrSpy = spyOnStderr();
    const { config, usedFallback } = loadConfig({ cwd: projectDir, home: homeDir });
    expect(usedFallback).toBe(true);
    expect(config.chop.enabled).toBe(false);
    expect(stderrSpy.written.some((s) => s.includes("falling back to defaults"))).toBe(true);
    stderrSpy.restore();
  });

  it("never throws on a malformed (non-JSON) project config file", () => {
    writeFileSync(path.join(projectDir, "optiflow.config.json"), "{not valid json", "utf8");
    expect(() => loadConfig({ cwd: projectDir, home: homeDir })).not.toThrow();
    const { config, sources } = loadConfig({ cwd: projectDir, home: homeDir });
    expect(sources.project).toBeNull(); // unreadable -> treated as absent
    expect(config.chop.enabled).toBe(false);
  });

  it("a project config can override kompress/smartCrusher (regression: these were missing from TOP_LEVEL_SECTIONS)", () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ kompress: { enabled: true }, smartCrusher: { minSavingsPercent: 12 } }),
      "utf8"
    );

    const { config } = loadConfig({ cwd: projectDir, home: homeDir });
    expect(config.kompress.enabled).toBe(true);
    expect(config.smartCrusher.minSavingsPercent).toBe(12);
    // Untouched fields in the same sections still come from defaults.
    expect(config.kompress.variant).toBe(DEFAULT_CONFIG.kompress.variant);
    expect(config.smartCrusher.enabled).toBe(DEFAULT_CONFIG.smartCrusher.enabled);
  });

  it("finds a project root via a nested .git marker and resolves the project config there", () => {
    mkdirSync(path.join(projectDir, ".git"));
    const nested = path.join(projectDir, "src", "deep", "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ statusline: { debounceMs: 42 } }),
      "utf8"
    );

    const { config, sources } = loadConfig({ cwd: nested, home: homeDir });
    expect(sources.project).toBe(path.join(projectDir, "optiflow.config.json"));
    expect(config.statusline.debounceMs).toBe(42);
  });
});

function spyOnStderr() {
  const written: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: any, ...rest: any[]) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    written,
    restore: () => {
      process.stderr.write = original;
    },
  };
}
