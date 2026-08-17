import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectRoot, getOptiflowHome } from "./paths.js";

const originalOptiflowHome = process.env.OPTIFLOW_HOME;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "optiflow-paths-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalOptiflowHome === undefined) {
    delete process.env.OPTIFLOW_HOME;
  } else {
    process.env.OPTIFLOW_HOME = originalOptiflowHome;
  }
});

describe("getOptiflowHome", () => {
  it("honors OPTIFLOW_HOME when set", () => {
    process.env.OPTIFLOW_HOME = dir;
    expect(getOptiflowHome()).toBe(path.resolve(dir));
  });

  it("falls back to ~/.optiflow when unset", () => {
    delete process.env.OPTIFLOW_HOME;
    expect(getOptiflowHome().endsWith(".optiflow")).toBe(true);
  });
});

describe("findProjectRoot", () => {
  it("finds a root via optiflow.config.json", () => {
    writeFileSync(path.join(dir, "optiflow.config.json"), "{}", "utf8");
    const nested = path.join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(dir);
  });

  it("finds a root when .git is a FILE, not a directory (submodule/worktree case)", () => {
    writeFileSync(path.join(dir, ".git"), "gitdir: ../.git/modules/foo\n", "utf8");
    const nested = path.join(dir, "src");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(dir);
  });

  it("falls back to the start directory when no marker is found", () => {
    // dir is a fresh temp directory with no .git / optiflow.config.json in
    // itself, and (on this machine) none of its ancestors up to the temp
    // root are inside a git repo either.
    expect(findProjectRoot(dir)).toBe(path.resolve(dir));
  });
});
