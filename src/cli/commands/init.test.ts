import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { runInitCli } from "./init.js";

describe("runInitCli", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "optiflow-init-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a valid optiflow.config.json matching DEFAULT_CONFIG when none exists", () => {
    const result = runInitCli({ cwd: dir });
    expect(result.wrote).toBe(true);

    const configPath = path.join(dir, "optiflow.config.json");
    expect(existsSync(configPath)).toBe(true);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(DEFAULT_CONFIG);
  });

  it("refuses to overwrite an existing optiflow.config.json without --force", () => {
    const configPath = path.join(dir, "optiflow.config.json");
    writeFileSync(configPath, JSON.stringify({ chop: { enabled: true } }), "utf8");

    const result = runInitCli({ cwd: dir });
    expect(result.wrote).toBe(false);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ chop: { enabled: true } });
  });

  it("overwrites an existing optiflow.config.json with --force", () => {
    const configPath = path.join(dir, "optiflow.config.json");
    writeFileSync(configPath, JSON.stringify({ chop: { enabled: true } }), "utf8");

    const result = runInitCli({ cwd: dir, force: true });
    expect(result.wrote).toBe(true);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(DEFAULT_CONFIG);
  });
});
