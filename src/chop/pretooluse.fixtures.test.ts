// Golden-fixture tests: pipes real JSON stdin payloads (fixtures/hooks/*.json)
// through the exact same `readHookInput` stdin-reading path a real Claude
// Code hook invocation uses, then asserts on the emitted hook output JSON.
// This is the phase's stated test gate: "golden fixtures green, including
// all compound-command negative cases."

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHookInput } from "../core/hook-io.js";
import { runPreToolUse } from "./pretooluse.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures/hooks/", import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function stdinFrom(text: string): NodeJS.ReadableStream {
  return Readable.from([text]) as unknown as NodeJS.ReadableStream;
}

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-fixtures-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-fixtures-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

async function runFixture(fixtureName: string, loadOptions: { cwd?: string; home?: string }) {
  const raw = loadFixture(fixtureName);
  return runPreToolUse(() => readHookInput(stdinFrom(raw)), loadOptions);
}

function enableChop(): void {
  writeFileSync(path.join(projectDir, "optiflow.config.json"), JSON.stringify({ chop: { enabled: true } }), "utf8");
}

describe("pretooluse golden fixtures — chop.enabled: true", () => {
  beforeEach(enableChop);

  it("positive: git status -> updatedInput present, command prefixed correctly", async () => {
    const output = await runFixture("pretooluse-positive-git-status.json", { cwd: projectDir, home: homeDir });
    expect(output.hookSpecificOutput?.updatedInput).toEqual({
      command: "optiflow-chop git status",
      description: "Check the working tree status before committing",
    });
  });

  it("negative: cd src && npm test -> no updatedInput", async () => {
    const output = await runFixture("pretooluse-negative-compound-command.json", { cwd: projectDir, home: homeDir });
    expect(output.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("negative: git log | head -20 -> no updatedInput", async () => {
    const output = await runFixture("pretooluse-negative-piped-command.json", { cwd: projectDir, home: homeDir });
    expect(output.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("negative: git status > out.txt -> no updatedInput", async () => {
    const output = await runFixture("pretooluse-negative-redirected-command.json", { cwd: projectDir, home: homeDir });
    expect(output.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("negative: echo `date` -> no updatedInput", async () => {
    const output = await runFixture("pretooluse-negative-command-substitution.json", { cwd: projectDir, home: homeDir });
    expect(output.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("negative: npm run build -> excluded, no updatedInput", async () => {
    const output = await runFixture("pretooluse-negative-excluded-npm-run-build.json", {
      cwd: projectDir,
      home: homeDir,
    });
    expect(output.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("negative: npm test -> excluded, no updatedInput", async () => {
    const output = await runFixture("pretooluse-negative-excluded-npm-test.json", { cwd: projectDir, home: homeDir });
    expect(output.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("negative: Read tool call -> hook never even attempts rewrite logic beyond the early return", async () => {
    const output = await runFixture("pretooluse-negative-non-bash-tool.json", { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});
  });
});

describe("pretooluse golden fixtures — chop.enabled: false (the real default)", () => {
  it("positive-looking fixture (git status) still produces no updatedInput when chop is disabled", async () => {
    const output = await runFixture("pretooluse-positive-git-status.json", { cwd: projectDir, home: homeDir });
    expect(output.hookSpecificOutput?.updatedInput).toBeUndefined();
    expect(output).toEqual({});
  });
});
