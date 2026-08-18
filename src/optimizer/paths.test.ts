import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getOptimizerHome,
  getOptimizerConfigPath,
  getOptimizerCacheDir,
  getOptimizerCacheDbPath,
  getOptimizerAnalyticsDbPath,
  getOptimizerSessionsPath,
  getOptimizerWikiDir,
  getOptimizerProjectsJsonlPath,
  getOptimizerBackupsDir,
} from "./paths.js";

const originalOptiflowHome = process.env.OPTIFLOW_HOME;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "optiflow-optimizer-paths-test-"));
  process.env.OPTIFLOW_HOME = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalOptiflowHome === undefined) {
    delete process.env.OPTIFLOW_HOME;
  } else {
    process.env.OPTIFLOW_HOME = originalOptiflowHome;
  }
});

describe("optimizer path helpers", () => {
  it("nest everything under getOptiflowHome()/optimizer, honoring OPTIFLOW_HOME", () => {
    expect(getOptimizerHome()).toBe(path.join(path.resolve(dir), "optimizer"));
  });

  it("resolve every persisted file/dir under the optimizer subtree, not ~/.token-optimizer* or ~/.hypercontext*", () => {
    const home = getOptimizerHome();
    expect(getOptimizerConfigPath()).toBe(path.join(home, "config.json"));
    expect(getOptimizerCacheDir()).toBe(path.join(home, "cache"));
    expect(getOptimizerCacheDbPath()).toBe(path.join(home, "cache", "cache.db"));
    expect(getOptimizerAnalyticsDbPath()).toBe(path.join(home, "analytics.db"));
    expect(getOptimizerSessionsPath()).toBe(path.join(home, "sessions.json"));
    expect(getOptimizerWikiDir()).toBe(path.join(home, "wiki"));
    expect(getOptimizerProjectsJsonlPath()).toBe(path.join(home, "projects.jsonl"));
    expect(getOptimizerBackupsDir()).toBe(path.join(home, "backups"));
  });

  it("never mentions token-optimizer or hypercontext in any resolved path", () => {
    const resolved = [
      getOptimizerHome(),
      getOptimizerConfigPath(),
      getOptimizerCacheDir(),
      getOptimizerCacheDbPath(),
      getOptimizerAnalyticsDbPath(),
      getOptimizerSessionsPath(),
      getOptimizerWikiDir(),
      getOptimizerProjectsJsonlPath(),
      getOptimizerBackupsDir(),
    ];
    for (const p of resolved) {
      expect(p.toLowerCase()).not.toContain("token-optimizer");
      expect(p.toLowerCase()).not.toContain("hypercontext");
    }
  });
});
