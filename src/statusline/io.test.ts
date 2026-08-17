import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readActivityBeacon, readRecentSavings, readStatuslineConfig } from "./io.js";

let homeDir: string;
let projectDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-statusline-home-"));
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-statusline-project-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

function ledgerRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    module: "toon",
    command_or_context: "test",
    tokensBefore: 1000,
    tokensAfter: 400,
    bytesBefore: 4000,
    bytesAfter: 1600,
    ...overrides,
  };
}

describe("readActivityBeacon", () => {
  it("returns null when the file is absent", () => {
    expect(readActivityBeacon({ home: homeDir })).toBeNull();
  });

  it("returns null for an empty/malformed activity file", () => {
    writeFileSync(path.join(homeDir, "activity.json"), "not json", "utf8");
    expect(readActivityBeacon({ home: homeDir })).toBeNull();
  });

  it("returns null when the file has neither tool nor timestamp", () => {
    writeFileSync(path.join(homeDir, "activity.json"), JSON.stringify({}), "utf8");
    expect(readActivityBeacon({ home: homeDir })).toBeNull();
  });

  it("parses a valid activity beacon", () => {
    writeFileSync(path.join(homeDir, "activity.json"), JSON.stringify({ tool: "Bash", timestamp: 12345 }), "utf8");
    expect(readActivityBeacon({ home: homeDir })).toEqual({ tool: "Bash", timestamp: 12345 });
  });
});

describe("readRecentSavings — missing/empty ledger", () => {
  it("returns null when ledger.jsonl doesn't exist", () => {
    expect(readRecentSavings({ home: homeDir })).toBeNull();
  });

  it("returns null when ledger.jsonl exists but is empty", () => {
    writeFileSync(path.join(homeDir, "ledger.jsonl"), "", "utf8");
    expect(readRecentSavings({ home: homeDir })).toBeNull();
  });

  it("never throws for a garbage (non-JSONL) ledger file", () => {
    writeFileSync(path.join(homeDir, "ledger.jsonl"), "this is not jsonl\nnor is this\n", "utf8");
    expect(() => readRecentSavings({ home: homeDir })).not.toThrow();
    expect(readRecentSavings({ home: homeDir })).toBeNull();
  });
});

describe("readRecentSavings — small ledger (well under the tail-read window)", () => {
  it("sums tokensBefore - tokensAfter across recent records", () => {
    const now = Date.now();
    const lines = [ledgerRecord({ tokensBefore: 1000, tokensAfter: 400 }), ledgerRecord({ tokensBefore: 500, tokensAfter: 300 })]
      .map((r) => JSON.stringify(r))
      .join("\n");
    writeFileSync(path.join(homeDir, "ledger.jsonl"), lines + "\n", "utf8");

    const result = readRecentSavings({ home: homeDir, now });
    expect(result).not.toBeNull();
    expect(result?.tokensSaved).toBe(600 + 200);
    expect(result?.recordCount).toBe(2);
  });

  it("excludes records older than the recency window", () => {
    const now = Date.now();
    const stale = ledgerRecord({
      timestamp: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      tokensBefore: 1000,
      tokensAfter: 100,
    });
    writeFileSync(path.join(homeDir, "ledger.jsonl"), JSON.stringify(stale) + "\n", "utf8");

    expect(readRecentSavings({ home: homeDir, now })).toBeNull();
  });

  it("never lets an inflating record (tokensAfter > tokensBefore) subtract from the total", () => {
    const now = Date.now();
    const inflated = ledgerRecord({ tokensBefore: 100, tokensAfter: 500 });
    const good = ledgerRecord({ tokensBefore: 1000, tokensAfter: 400 });
    const lines = [inflated, good].map((r) => JSON.stringify(r)).join("\n");
    writeFileSync(path.join(homeDir, "ledger.jsonl"), lines + "\n", "utf8");

    const result = readRecentSavings({ home: homeDir, now });
    // The inflated record contributes max(0, 100-500) = 0, not -400.
    expect(result?.tokensSaved).toBe(600);
  });
});

describe("readRecentSavings — ledger larger than the bounded tail-read window", () => {
  it("only reads the tail and never throws, on a ledger well over 8KB", () => {
    const now = Date.now();
    const paddingRecord = ledgerRecord({
      timestamp: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      command_or_context: "x".repeat(200),
      tokensBefore: 1,
      tokensAfter: 1,
    });
    const paddingLine = JSON.stringify(paddingRecord);
    // ~200 lines * ~250 bytes/line comfortably exceeds the 8KB tail window.
    const padding = Array.from({ length: 200 }, () => paddingLine).join("\n");
    const recentRecord = ledgerRecord({ timestamp: new Date(now).toISOString(), tokensBefore: 900, tokensAfter: 100 });

    writeFileSync(path.join(homeDir, "ledger.jsonl"), padding + "\n" + JSON.stringify(recentRecord) + "\n", "utf8");

    expect(() => readRecentSavings({ home: homeDir, now })).not.toThrow();
    const result = readRecentSavings({ home: homeDir, now });
    expect(result).not.toBeNull();
    // The old padding records are outside the recency window regardless of
    // whether the byte window happens to include any of them; only the
    // trailing recent record should count.
    expect(result?.tokensSaved).toBe(800);
    expect(result?.recordCount).toBe(1);
  });
});

describe("readStatuslineConfig", () => {
  it("returns an empty object when no config file exists anywhere", () => {
    expect(readStatuslineConfig({ home: homeDir, cwd: projectDir })).toEqual({});
  });

  it("reads statusline.enabled/segments/meterWidth from user-global config.json", () => {
    writeFileSync(
      path.join(homeDir, "config.json"),
      JSON.stringify({ statusline: { enabled: false, segments: ["cost", "model"], meterWidth: 20 } }),
      "utf8"
    );
    const config = readStatuslineConfig({ home: homeDir, cwd: projectDir });
    expect(config).toEqual({ enabled: false, segments: ["cost", "model"], meterWidth: 20 });
  });

  it("lets project config override user-global config, per key", () => {
    writeFileSync(
      path.join(homeDir, "config.json"),
      JSON.stringify({ statusline: { enabled: false, meterWidth: 20 } }),
      "utf8"
    );
    writeFileSync(path.join(projectDir, ".git"), "gitdir: elsewhere", "utf8");
    writeFileSync(path.join(projectDir, "optiflow.config.json"), JSON.stringify({ statusline: { enabled: true } }), "utf8");

    const config = readStatuslineConfig({ home: homeDir, cwd: projectDir });
    expect(config.enabled).toBe(true);
    expect(config.meterWidth).toBe(20);
  });

  it("ignores an invalid segments array (unknown segment name) rather than throwing", () => {
    writeFileSync(
      path.join(homeDir, "config.json"),
      JSON.stringify({ statusline: { segments: ["meter", "not-a-real-segment"] } }),
      "utf8"
    );
    expect(() => readStatuslineConfig({ home: homeDir, cwd: projectDir })).not.toThrow();
    expect(readStatuslineConfig({ home: homeDir, cwd: projectDir }).segments).toBeUndefined();
  });

  it("never throws for a malformed config.json", () => {
    writeFileSync(path.join(homeDir, "config.json"), "{not json", "utf8");
    expect(() => readStatuslineConfig({ home: homeDir, cwd: projectDir })).not.toThrow();
  });
});
