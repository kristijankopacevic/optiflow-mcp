import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRangeFlag, resolveReportFiles, runReportCli } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILE = path.resolve(__dirname, "../../../fixtures/transcripts/sample.jsonl");

describe("parseRangeFlag", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");

  it("parses 'Nd' as a window ending now", () => {
    const range = parseRangeFlag("7d", now);
    expect(range.startMs).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(range.endMs).toBe(now.getTime());
    expect(range.warning).toBeUndefined();
  });

  it("parses 'Nh' as a window ending now", () => {
    const range = parseRangeFlag("24h", now);
    expect(range.startMs).toBe(now.getTime() - 24 * 60 * 60 * 1000);
    expect(range.endMs).toBe(now.getTime());
  });

  it("treats 'all' and undefined as no filtering", () => {
    expect(parseRangeFlag("all", now)).toEqual({});
    expect(parseRangeFlag(undefined, now)).toEqual({});
  });

  it("fails open (no filtering) with a warning for an unrecognized shape", () => {
    const range = parseRangeFlag("banana", now);
    expect(range.startMs).toBeUndefined();
    expect(range.endMs).toBeUndefined();
    expect(range.warning).toMatch(/unrecognized/);
  });
});

describe("resolveReportFiles", () => {
  let projectsDir: string;

  beforeEach(() => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "optiflow-report-resolve-test-"));
  });

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
  });

  it("returns the explicit file untouched when given, bypassing discovery entirely", () => {
    expect(resolveReportFiles("/some/explicit/path.jsonl", { projectsDir })).toEqual([
      "/some/explicit/path.jsonl",
    ]);
  });

  it("uses --session discovery when no explicit file is given", () => {
    const slugDir = path.join(projectsDir, "slug-a");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(path.join(slugDir, "sess-1.jsonl"), "{}\n", "utf8");

    expect(resolveReportFiles(undefined, { session: "sess-1", projectsDir })).toEqual([
      path.join(slugDir, "sess-1.jsonl"),
    ]);
  });

  it("uses --all discovery across every project when set", () => {
    mkdirSync(path.join(projectsDir, "slug-a"), { recursive: true });
    mkdirSync(path.join(projectsDir, "slug-b"), { recursive: true });
    writeFileSync(path.join(projectsDir, "slug-a", "s1.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(projectsDir, "slug-b", "s2.jsonl"), "{}\n", "utf8");

    expect(resolveReportFiles(undefined, { all: true, projectsDir })).toHaveLength(2);
  });
});

describe("runReportCli — integration against fixtures/transcripts/sample.jsonl", () => {
  let logHome: string;

  beforeEach(() => {
    logHome = mkdtempSync(path.join(tmpdir(), "optiflow-report-cli-test-"));
  });

  afterEach(() => {
    rmSync(logHome, { recursive: true, force: true });
  });

  it("produces correct computed output (not just 'doesn't crash') in table format", async () => {
    const { stdout, stderr, analysis } = await runReportCli([FIXTURE_FILE], { format: "table", logHome });

    expect(analysis.turnCount).toBe(5);
    expect(analysis.mainThreadTurnCount).toBe(3);
    expect(analysis.sidechainTurnCount).toBe(2);
    expect(analysis.totals.totalTokens).toBe(3155 + 796);
    expect(analysis.cacheBreaks).toHaveLength(1);

    expect(stdout).toContain("optiflow report");
    expect(stdout).toContain(analysis.totals.totalTokens.toLocaleString("en-US"));
    // Two malformed lines in the fixture must be reported, not silently dropped.
    expect(stderr).toMatch(/skipped 2 unparseable line/);
  });

  it("produces valid JSON in json format matching the analyzed totals", async () => {
    const { stdout, analysis } = await runReportCli([FIXTURE_FILE], { format: "json", logHome });
    const parsed = JSON.parse(stdout);
    expect(parsed.totals.totalTokens).toBe(analysis.totals.totalTokens);
    expect(parsed.subagents).toHaveLength(1);
  });

  it("produces markdown containing the expected key figures", async () => {
    const { stdout } = await runReportCli([FIXTURE_FILE], { format: "markdown", logHome });
    expect(stdout).toContain("# optiflow report");
    expect(stdout).toContain("## Cache breaks");
  });

  it("respects --top", async () => {
    const { analysis } = await runReportCli([FIXTURE_FILE], { top: 2, logHome });
    expect(analysis.topTurns).toHaveLength(2);
  });

  it("reports 'no transcript files found' cleanly when given an empty file list, without crashing", async () => {
    const { stdout, stderr, analysis } = await runReportCli([], { logHome });
    expect(analysis.turnCount).toBe(0);
    expect(stderr).toMatch(/no transcript files found/);
    expect(stdout).toContain("optiflow report");
  });

  it("surfaces --include-optimizer as an explicit unavailable note, not a silent no-op", async () => {
    const { stderr } = await runReportCli([FIXTURE_FILE], { includeOptimizer: true, logHome });
    expect(stderr).toMatch(/--include-optimizer requested but not available/);
  });

  it("reports (rather than crashes on) a file that doesn't exist", async () => {
    const { stderr, analysis } = await runReportCli(["/definitely/does/not/exist.jsonl"], { logHome });
    expect(stderr).toMatch(/could not read/);
    expect(analysis.turnCount).toBe(0);
  });
});
