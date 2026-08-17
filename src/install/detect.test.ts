import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectHeadroomWrap } from "./detect.js";

// Focused test for the `home` override added to `detectHeadroomWrap` so
// `optiflow install`'s Risk R1 refusal (and its own tests) can be sandboxed
// against a scratch settings.json instead of ever touching the real
// `~/.claude/settings.json`. Default behavior (home omitted) is intentionally
// left unexercised here — it's the pre-existing `homedir()` fallback and
// isn't something this task changed.

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-detect-home-test-"));
  cwd = mkdtempSync(path.join(tmpdir(), "optiflow-detect-cwd-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("detectHeadroomWrap — home override", () => {
  it("inspects <home>/.claude/settings.json when home is passed explicitly", () => {
    const claudeDir = path.join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1234" } }),
      "utf8"
    );

    const result = detectHeadroomWrap({ cwd, home });
    expect(result.wrapped).toBe(true);
    expect(result.signals[0]?.filePath).toBe(path.join(claudeDir, "settings.json"));
    expect(result.signals[0]?.envKeysFound).toContain("ANTHROPIC_BASE_URL");
  });

  it("reports no wrap when the scratch home has no signal, regardless of the real machine's own settings", () => {
    const result = detectHeadroomWrap({ cwd, home });
    expect(result.wrapped).toBe(false);
  });
});
