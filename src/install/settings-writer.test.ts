import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `node:fs`'s ESM named exports are non-configurable, so `vi.spyOn` can't
// intercept them directly (Vitest's own documented limitation). Mocking the
// whole module and wrapping just `renameSync` in a pass-through `vi.fn` lets
// `atomicWriteFile`'s tests below force a rename failure on demand while
// every other `node:fs` call (used throughout this file and inside
// settings-writer.ts) keeps its real behavior.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
import {
  atomicWriteFile,
  backupSettingsFile,
  buildOptiflowStatusLineValue,
  findLatestBackup,
  isOptiflowStatusLineValue,
  readSettingsFile,
  removeSettingsKey,
  resolveDefaultSettingsPath,
  restoreSettingsBackup,
  setOptiflowStatusLine,
  uninstallOptiflowStatusLine,
  writeSettingsKey,
} from "./settings-writer.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "optiflow-settings-writer-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function settingsPath(): string {
  return path.join(dir, "settings.json");
}

describe("resolveDefaultSettingsPath", () => {
  it("joins <home>/.claude/settings.json", () => {
    expect(resolveDefaultSettingsPath("/home/x")).toBe(path.join("/home/x", ".claude", "settings.json"));
  });
});

describe("readSettingsFile", () => {
  it("treats a missing file as {}", () => {
    expect(readSettingsFile(settingsPath())).toEqual({});
  });

  it("treats an empty/whitespace-only file as {}", () => {
    writeFileSync(settingsPath(), "   \n", "utf8");
    expect(readSettingsFile(settingsPath())).toEqual({});
  });

  it("returns the parsed object for valid JSON", () => {
    writeFileSync(settingsPath(), JSON.stringify({ foo: "bar" }), "utf8");
    expect(readSettingsFile(settingsPath())).toEqual({ foo: "bar" });
  });

  it("refuses (throws) on malformed JSON rather than silently discarding it", () => {
    writeFileSync(settingsPath(), "{ this is not valid json,,, ", "utf8");
    expect(() => readSettingsFile(settingsPath())).toThrow(/not valid JSON/);
  });

  it("refuses on a top-level array", () => {
    writeFileSync(settingsPath(), "[1,2,3]", "utf8");
    expect(() => readSettingsFile(settingsPath())).toThrow(/not an object/);
  });

  it("refuses on a top-level scalar", () => {
    writeFileSync(settingsPath(), "42", "utf8");
    expect(() => readSettingsFile(settingsPath())).toThrow(/not an object/);
  });
});

describe("writeSettingsKey — fresh file (backup skipped)", () => {
  it("creates the file, sets the key, and reports no backup (nothing to lose)", () => {
    const result = writeSettingsKey(settingsPath(), "statusLine", { type: "command", command: "x" });
    expect(result.backupPath).toBeNull();
    expect(readFileSync(settingsPath(), "utf8")).toContain('"statusLine"');
    expect(readSettingsFile(settingsPath())).toEqual({ statusLine: { type: "command", command: "x" } });
  });

  it("creates parent directories as needed", () => {
    const nested = path.join(dir, "a", "b", "settings.json");
    writeSettingsKey(nested, "statusLine", { type: "command", command: "x" });
    expect(readSettingsFile(nested)).toEqual({ statusLine: { type: "command", command: "x" } });
  });
});

describe("writeSettingsKey — existing file with unrelated keys", () => {
  it("preserves every other key untouched, adds the new key, and creates a backup", () => {
    const original = { other: "value", nested: { a: 1, b: [1, 2, 3] } };
    writeFileSync(settingsPath(), JSON.stringify(original, null, 2), "utf8");

    const result = writeSettingsKey(settingsPath(), "statusLine", { type: "command", command: "x" }, {
      now: new Date(1_000_000),
    });

    expect(result.backupPath).toBe(`${settingsPath()}.optiflow-backup-1000000`);
    expect(readFileSync(result.backupPath as string, "utf8")).toBe(JSON.stringify(original, null, 2));

    const after = readSettingsFile(settingsPath());
    expect(after.other).toBe("value");
    expect(after.nested).toEqual({ a: 1, b: [1, 2, 3] });
    expect(after.statusLine).toEqual({ type: "command", command: "x" });
  });
});

describe("atomicWriteFile", () => {
  it("uses temp-file-then-rename and leaves the original untouched if rename fails", () => {
    const target = settingsPath();
    writeFileSync(target, "ORIGINAL", "utf8");

    const renameMock = vi.mocked(fs.renameSync);
    renameMock.mockImplementationOnce(() => {
      throw new Error("simulated rename failure");
    });

    expect(() => atomicWriteFile(target, "NEW CONTENT")).toThrow(/simulated rename failure/);

    // Original file is untouched — the failed write never mutated it in place.
    expect(readFileSync(target, "utf8")).toBe("ORIGINAL");

    // No leftover temp file in the directory.
    const leftoverTemp = readdirSync(dir).filter((entry) => entry.includes(".optiflow-tmp-"));
    expect(leftoverTemp).toEqual([]);
  });

  it("actually renames rather than writing in place (temp file observed mid-flight)", () => {
    const target = settingsPath();
    const renameMock = vi.mocked(fs.renameSync);
    const callsBefore = renameMock.mock.calls.length;
    atomicWriteFile(target, "hello");
    expect(renameMock.mock.calls.length).toBe(callsBefore + 1);
    const [tempArg, targetArg] = renameMock.mock.calls[callsBefore] as [string, string];
    expect(path.dirname(tempArg)).toBe(dir);
    expect(path.basename(tempArg)).toContain(".optiflow-tmp-");
    expect(targetArg).toBe(target);
  });
});

describe("isOptiflowStatusLineValue", () => {
  it("recognizes optiflow's own command shape, with backslash paths normalized", () => {
    // A single literal backslash per separator (what the in-memory string
    // actually looks like once parsed out of JSON on Windows), not the
    // doubled backslashes JSON's own escaping would show on disk.
    expect(
      isOptiflowStatusLineValue({
        type: "command",
        command: 'node "C:\\repo\\plugin\\scripts\\statusline.mjs"',
      })
    ).toBe(true);
    expect(
      isOptiflowStatusLineValue({ type: "command", command: 'node "/repo/plugin/scripts/statusline.mjs"' })
    ).toBe(true);
  });

  it("rejects a foreign statusLine", () => {
    expect(isOptiflowStatusLineValue({ type: "command", command: "node other-script.mjs" })).toBe(false);
    expect(isOptiflowStatusLineValue("just-a-string")).toBe(false);
    expect(isOptiflowStatusLineValue(null)).toBe(false);
    expect(isOptiflowStatusLineValue(undefined)).toBe(false);
    expect(isOptiflowStatusLineValue({ type: "command" })).toBe(false);
  });
});

describe("setOptiflowStatusLine", () => {
  it("writes fresh (no prior file, backup skipped)", () => {
    const result = setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs");
    expect(result.status).toBe("written");
    expect(result).toMatchObject({ status: "written", backupPath: null });
    expect(readSettingsFile(settingsPath()).statusLine).toEqual(
      buildOptiflowStatusLineValue("/abs/plugin/scripts/statusline.mjs")
    );
  });

  it("refuses without --force when a DIFFERENT statusLine is already set, and does not write", () => {
    writeFileSync(settingsPath(), JSON.stringify({ statusLine: { type: "command", command: "other.mjs" } }), "utf8");

    const result = setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs");
    expect(result.status).toBe("refused-foreign");
    // Untouched.
    expect(readSettingsFile(settingsPath()).statusLine).toEqual({ type: "command", command: "other.mjs" });
  });

  it("succeeds with force, and still backs up the original first", () => {
    const original = { statusLine: { type: "command", command: "other.mjs" }, keep: "me" };
    writeFileSync(settingsPath(), JSON.stringify(original), "utf8");

    const result = setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs", {
      force: true,
      now: new Date(42),
    });

    expect(result.status).toBe("written");
    expect(result).toMatchObject({ status: "written", backupPath: `${settingsPath()}.optiflow-backup-42` });
    expect(JSON.parse(readFileSync(`${settingsPath()}.optiflow-backup-42`, "utf8"))).toEqual(original);

    const after = readSettingsFile(settingsPath());
    expect(after.keep).toBe("me");
    expect(after.statusLine).toEqual(buildOptiflowStatusLineValue("/abs/plugin/scripts/statusline.mjs"));
  });

  it("is idempotent: re-running when optiflow's own statusline is already active makes no change and creates no backup", () => {
    setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs", { now: new Date(1) });
    const beforeSecondRun = readFileSync(settingsPath(), "utf8");

    const result = setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs", { now: new Date(2) });
    expect(result.status).toBe("already-active");
    expect(readFileSync(settingsPath(), "utf8")).toBe(beforeSecondRun);

    const backups = readdirSync(dir).filter((entry) => entry.includes(".optiflow-backup-"));
    expect(backups).toEqual([]);
  });
});

describe("findLatestBackup / restoreSettingsBackup", () => {
  it("finds the most recent backup by numeric suffix, not readdir/mtime order", () => {
    writeFileSync(`${settingsPath()}.optiflow-backup-100`, "old", "utf8");
    writeFileSync(`${settingsPath()}.optiflow-backup-9999999999999`, "newest", "utf8");
    writeFileSync(`${settingsPath()}.optiflow-backup-500`, "middle", "utf8");

    const latest = findLatestBackup(settingsPath());
    expect(latest?.timestampMs).toBe(9999999999999);
    expect(readFileSync(latest!.backupPath, "utf8")).toBe("newest");
  });

  it("returns null when no backups exist", () => {
    expect(findLatestBackup(settingsPath())).toBeNull();
  });

  it("restores the most recent backup's content, and itself backs up the pre-restore state", () => {
    writeFileSync(settingsPath(), JSON.stringify({ statusLine: "current-bad" }), "utf8");
    writeFileSync(`${settingsPath()}.optiflow-backup-1`, JSON.stringify({ original: true }), "utf8");
    writeFileSync(`${settingsPath()}.optiflow-backup-2`, JSON.stringify({ original: "newer" }), "utf8");

    const result = restoreSettingsBackup(settingsPath(), { now: new Date(999) });
    expect(result.status).toBe("restored");
    if (result.status !== "restored") throw new Error("unreachable");
    expect(result.fromBackup).toBe(`${settingsPath()}.optiflow-backup-2`);
    // Pre-restore snapshot lives in a DIFFERENT namespace (.optiflow-prerestore-,
    // not .optiflow-backup-) so it can never be picked up by findLatestBackup
    // and accidentally restored right back over itself on a second run.
    expect(result.preRestoreBackup).toBe(`${settingsPath()}.optiflow-prerestore-999`);

    expect(readSettingsFile(settingsPath())).toEqual({ original: "newer" });
    expect(JSON.parse(readFileSync(result.preRestoreBackup as string, "utf8"))).toEqual({
      statusLine: "current-bad",
    });
  });

  it("a pre-restore snapshot is never itself picked up as the latest backup (regression: repeat restore must not reverse itself)", () => {
    writeFileSync(settingsPath(), JSON.stringify({ statusLine: "active" }), "utf8");
    writeFileSync(`${settingsPath()}.optiflow-backup-1`, JSON.stringify({ original: true }), "utf8");

    const first = restoreSettingsBackup(settingsPath(), { now: new Date(50) });
    expect(first.status).toBe("restored");

    // A second restore call with nothing left in the real backup namespace
    // (only the .optiflow-backup-1 file, already consumed logically — it's
    // still on disk, findLatestBackup would find IT again, which is fine:
    // the risk this test guards is the prerestore snapshot being found
    // instead and looping back to the "active" state).
    const latestAfterFirstRestore = findLatestBackup(settingsPath());
    expect(latestAfterFirstRestore?.backupPath).toBe(`${settingsPath()}.optiflow-backup-1`);
    expect(readFileSync(latestAfterFirstRestore!.backupPath, "utf8")).not.toContain("statusLine");
  });

  it("reports no-backup-found rather than throwing", () => {
    writeFileSync(settingsPath(), "{}", "utf8");
    expect(restoreSettingsBackup(settingsPath())).toEqual({
      status: "no-backup-found",
      settingsPath: settingsPath(),
    });
  });
});

describe("removeSettingsKey", () => {
  it("removes the key and preserves everything else, backing up first", () => {
    writeFileSync(settingsPath(), JSON.stringify({ statusLine: { x: 1 }, keep: "me" }), "utf8");
    const result = removeSettingsKey(settingsPath(), "statusLine", { now: new Date(7) });
    expect(result).toEqual({ removed: true, backupPath: `${settingsPath()}.optiflow-backup-7` });
    expect(readSettingsFile(settingsPath())).toEqual({ keep: "me" });
  });

  it("no-ops when the key is absent (no write, no backup)", () => {
    writeFileSync(settingsPath(), JSON.stringify({ keep: "me" }), "utf8");
    const before = readFileSync(settingsPath(), "utf8");
    const result = removeSettingsKey(settingsPath(), "statusLine");
    expect(result).toEqual({ removed: false, backupPath: null });
    expect(readFileSync(settingsPath(), "utf8")).toBe(before);
  });
});

describe("uninstallOptiflowStatusLine", () => {
  it("reports settings-file-missing when there's nothing there at all", () => {
    expect(uninstallOptiflowStatusLine(settingsPath())).toEqual({
      status: "settings-file-missing",
      settingsPath: settingsPath(),
    });
  });

  it("reports no-statusline-to-remove when the file exists but has no statusLine key", () => {
    writeFileSync(settingsPath(), JSON.stringify({ other: 1 }), "utf8");
    expect(uninstallOptiflowStatusLine(settingsPath())).toEqual({
      status: "no-statusline-to-remove",
      settingsPath: settingsPath(),
    });
  });

  it("restores from backup when optiflow previously activated the statusline on a machine that HAD a prior settings.json", () => {
    // Simulate install: had a pre-existing file, then optiflow activated the statusline.
    writeFileSync(settingsPath(), JSON.stringify({ prior: "config" }), "utf8");
    const install = setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs", {
      now: new Date(10),
    });
    expect(install.status).toBe("written");

    const result = uninstallOptiflowStatusLine(settingsPath(), { now: new Date(20) });
    expect(result.status).toBe("restored-from-backup");
    expect(readSettingsFile(settingsPath())).toEqual({ prior: "config" });
  });

  it("removes the key (no restore) when optiflow activated it on a machine with NO prior settings.json (no backup was ever created)", () => {
    // Simulate install on a fresh machine: no pre-existing file at all.
    const install = setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs");
    expect(install).toMatchObject({ status: "written", backupPath: null });
    expect(findLatestBackup(settingsPath())).toBeNull();

    const result = uninstallOptiflowStatusLine(settingsPath());
    expect(result.status).toBe("key-removed");
    expect(readSettingsFile(settingsPath())).toEqual({});
  });

  it("refuses without --force when the current statusLine no longer looks like optiflow's own", () => {
    writeFileSync(settingsPath(), JSON.stringify({ statusLine: { type: "command", command: "someone-elses.mjs" } }), "utf8");
    const result = uninstallOptiflowStatusLine(settingsPath());
    expect(result.status).toBe("refused-foreign-statusline");
    expect(readSettingsFile(settingsPath()).statusLine).toEqual({ type: "command", command: "someone-elses.mjs" });
  });

  it("removes/restores anyway with --force", () => {
    writeFileSync(settingsPath(), JSON.stringify({ statusLine: { type: "command", command: "someone-elses.mjs" } }), "utf8");
    const result = uninstallOptiflowStatusLine(settingsPath(), { force: true });
    expect(result.status).toBe("key-removed");
    expect(readSettingsFile(settingsPath())).toEqual({});
  });

  it("regression: running uninstall twice does not re-activate the statusline", () => {
    // Machine had a prior settings.json (so install creates a real,
    // restorable backup) — the exact scenario that previously broke:
    // uninstall's own pre-restore snapshot was landing in the same
    // .optiflow-backup- namespace findLatestBackup scans, so a SECOND
    // uninstall picked IT UP as "the latest backup" and restored optiflow's
    // statusline right back.
    writeFileSync(settingsPath(), JSON.stringify({ prior: "config" }), "utf8");
    const install = setOptiflowStatusLine(settingsPath(), "/abs/plugin/scripts/statusline.mjs", {
      now: new Date(1),
    });
    expect(install.status).toBe("written");

    const firstUninstall = uninstallOptiflowStatusLine(settingsPath(), { now: new Date(2) });
    expect(firstUninstall.status).toBe("restored-from-backup");
    expect(readSettingsFile(settingsPath())).toEqual({ prior: "config" });

    const secondUninstall = uninstallOptiflowStatusLine(settingsPath(), { now: new Date(3) });
    expect(secondUninstall.status).toBe("no-statusline-to-remove");
    expect(readSettingsFile(settingsPath())).toEqual({ prior: "config" });
  });
});

describe("backupSettingsFile", () => {
  it("returns null when there's nothing to back up", () => {
    expect(backupSettingsFile(settingsPath(), 1)).toBeNull();
  });
});
