import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStatusline } from "./cli.js";
import type { StatuslineInput } from "./render.js";

let homeDir: string;
let projectDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-statusline-cli-home-"));
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-statusline-cli-project-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("runStatusline — assembles stdin + I/O reads into a rendered line", () => {
  it("renders normally with no ledger/activity/config present at all", async () => {
    const input: StatuslineInput = {
      model: { display_name: "Claude Opus 4.1" },
      cost: { total_cost_usd: 0.5 },
      context_window: { used_percentage: 10 },
    };
    const out = await runStatusline(async () => input, { home: homeDir, cwd: projectDir });
    expect(out).toContain("Claude Opus 4.1");
    expect(out).toContain("$0.50");
    expect(out).not.toContain("♻");
    expect(out).not.toContain("⚙");
  });

  it("never throws on null stdin (malformed/empty payload) and still renders a fallback line", async () => {
    const out = await runStatusline(async () => null, { home: homeDir, cwd: projectDir });
    expect(out).toContain("--%");
    expect(out).toContain("unknown-model");
  });

  it("picks up a fresh activity beacon and recent ledger savings from disk", async () => {
    const now = Date.now();
    writeFileSync(path.join(homeDir, "activity.json"), JSON.stringify({ tool: "Grep", timestamp: now }), "utf8");
    writeFileSync(
      path.join(homeDir, "ledger.jsonl"),
      JSON.stringify({
        timestamp: new Date(now).toISOString(),
        module: "chop",
        command_or_context: "git status",
        tokensBefore: 500,
        tokensAfter: 100,
        bytesBefore: 2000,
        bytesAfter: 400,
      }) + "\n",
      "utf8"
    );

    const out = await runStatusline(async () => ({}), { home: homeDir, cwd: projectDir, now });
    expect(out).toContain("⚙ Grep");
    expect(out).toContain("♻");
  });

  it("respects statusline.enabled: false from user-global config.json", async () => {
    writeFileSync(path.join(homeDir, "config.json"), JSON.stringify({ statusline: { enabled: false } }), "utf8");
    const out = await runStatusline(async () => ({}), { home: homeDir, cwd: projectDir });
    expect(out).toBe("");
  });
});
