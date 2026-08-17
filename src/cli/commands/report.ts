// `optiflow report [file] [--session <id>] [--all] [--range 7d] [--format
// table|json|md] [--top 10] [--include-optimizer]` — Module 2's CLI entry
// point.
//
// Mirrors `toon.ts`'s pattern: this file is thin commander wiring plus one
// directly-testable pure-ish core (`runReportCli`) that takes an already-
// resolved file list (no discovery/fs-globbing inside it) so tests can
// point it straight at `fixtures/transcripts/sample.jsonl` without ever
// touching `~/.claude/projects`. File DISCOVERY (`[file]` positional vs.
// `--session`/`--all`/current-project) is resolved separately by
// `resolveReportFiles`, which is what actually calls into `discover.ts`;
// `registerReportCommand`'s `.action()` is the only place that wires real
// stdin/stdout/fs together.
//
// `--include-optimizer` (`report.includeOptimizer` in optiflow.config.json)
// is documented in the plan as joining token-optimizer-mcp's own analytics
// DB by `sessionId`. That DB is SQLite (`better-sqlite3`), which this phase
// does not add as a dependency (out of scope / requires explicit
// approval). Passing `--include-optimizer` therefore does not silently
// no-op: it prints an explicit "optimizer data unavailable" note to
// stderr, so a user relying on the flag learns why nothing joined rather
// than assuming it quietly worked.

import type { Command } from "commander";
import { discoverAllProjectFiles, discoverBySessionId, discoverCurrentProjectFiles } from "../../transcript/discover.js";
import { parseTranscriptFile, type TranscriptRecord } from "../../transcript/parse.js";
import { analyze, type AnalysisResult } from "../../transcript/analyze.js";
import { renderReport, type ReportFormat } from "../../transcript/render.js";
import { loadConfig } from "../../config/load.js";

export interface RangeFilter {
  startMs?: number;
  endMs?: number;
  /** Set when `range` was provided but didn't match any recognized shape — the caller fails open (no filtering) and should surface this. */
  warning?: string;
}

/**
 * Parses `--range` into an inclusive `[startMs, endMs]` window. Supports,
 * at minimum (per the plan): `Nd` (days), `Nh` (hours), and `"all"`
 * (explicitly no filtering, also the default when `range` is omitted).
 * Never throws: an unrecognized shape fails OPEN (no filtering) with a
 * `warning` for the caller to surface, rather than crashing the report.
 */
export function parseRangeFlag(range: string | undefined, now: Date = new Date()): RangeFilter {
  if (!range || range.trim().toLowerCase() === "all") return {};

  const match = /^(\d+)\s*(d|h)$/i.exec(range.trim());
  if (!match) {
    return { warning: `unrecognized --range "${range}" (expected "Nd", "Nh", or "all") — showing all history instead` };
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const windowMs = unit === "d" ? amount * 24 * 60 * 60 * 1000 : amount * 60 * 60 * 1000;
  const endMs = now.getTime();
  return { startMs: endMs - windowMs, endMs };
}

function normalizeFormat(format: string | undefined): ReportFormat {
  if (format === "json") return "json";
  if (format === "markdown" || format === "md") return "markdown";
  return "table";
}

export interface ReportCliOptions {
  format?: string;
  range?: string;
  top?: number;
  includeOptimizer?: boolean;
  now?: Date;
  /** Override for `parseTranscriptFile`'s malformed-line logger (tests only — avoids writing to the real `~/.optiflow/logs`). */
  logHome?: string;
}

export interface ReportCliResult {
  stdout: string;
  stderr: string;
  analysis: AnalysisResult;
}

/**
 * The testable core: given an already-resolved list of transcript file
 * paths (no discovery/globbing here — see module header), parses each,
 * analyzes the combined record set, and renders it. Multiple files are
 * concatenated into one record set before analysis so cross-file totals
 * (e.g. `--all` across every project) are computed correctly rather than
 * per-file.
 */
export async function runReportCli(
  files: string[],
  options: ReportCliOptions = {}
): Promise<ReportCliResult> {
  const stderrLines: string[] = [];
  const allRecords: TranscriptRecord[] = [];
  let totalSkipped = 0;

  for (const file of files) {
    try {
      const { records, skipped } = await parseTranscriptFile(file, { logHome: options.logHome });
      // NOT `allRecords.push(...records)`: spreading a large array into a
      // function call is bounded by V8's call-stack argument limit
      // (RangeError past roughly 100k-500k elements, depending on engine/
      // build) — real transcript files on this machine run tens of
      // thousands of lines each, and `--all` concatenates every file, so
      // this must not depend on staying under that ceiling.
      for (const record of records) allRecords.push(record);
      totalSkipped += skipped;
    } catch (err) {
      stderrLines.push(
        `[optiflow report] could not read "${file}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const range = parseRangeFlag(options.range, options.now);
  if (range.warning) stderrLines.push(`[optiflow report] ${range.warning}`);

  const analysis = analyze(allRecords, {
    rangeStartMs: range.startMs,
    rangeEndMs: range.endMs,
    topN: options.top,
  });

  if (totalSkipped > 0) {
    stderrLines.push(`[optiflow report] skipped ${totalSkipped} unparseable line(s) across ${files.length} file(s)`);
  }
  if (files.length === 0) {
    stderrLines.push(
      "[optiflow report] no transcript files found — nothing to report (see --session/--all, or run from the directory Claude Code was launched from)"
    );
  }
  if (options.includeOptimizer) {
    stderrLines.push(
      "[optiflow report] --include-optimizer requested but not available: joining token-optimizer-mcp's own analytics DB (SQLite/better-sqlite3) is out of scope for this phase (no new dependency added) — showing transcript-only figures"
    );
  }

  const format = normalizeFormat(options.format);
  const stdout = `${renderReport(analysis, format)}\n`;
  const stderr = stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : "";

  return { stdout, stderr, analysis };
}

export interface ResolveFilesOptions {
  session?: string;
  all?: boolean;
  cwd?: string;
  projectsDir?: string;
}

/**
 * Resolves which transcript files to analyze, given a positional `file`
 * (explicit path — bypasses discovery entirely) or the discovery flags.
 * Precedence: explicit `file` > `--session` > `--all` > current-project
 * (derived from `cwd`, best-effort — see `discover.ts`'s header on why this
 * can legitimately find nothing).
 */
export function resolveReportFiles(file: string | undefined, options: ResolveFilesOptions = {}): string[] {
  if (file) return [file];
  if (options.session) return discoverBySessionId(options.session, { projectsDir: options.projectsDir });
  if (options.all) return discoverAllProjectFiles({ projectsDir: options.projectsDir });
  return discoverCurrentProjectFiles(options.cwd, { projectsDir: options.projectsDir });
}

export function registerReportCommand(program: Command): void {
  program
    .command("report [file]")
    .description(
      "Transcript token/cache analytics report — parses ~/.claude/projects/**/*.jsonl directly (a disjoint data source from token-optimizer's own analytics DB). Pass a file path to analyze one specific transcript directly."
    )
    .option("--session <id>", "analyze the transcript for one specific session id, regardless of project slug")
    .option("--all", "analyze transcripts across every project, not just the current one")
    .option("--range <range>", 'filter turns by timestamp: "7d", "24h", or "all" (default: all)')
    .option("--format <format>", "output format: table (default), json, or markdown/md", "table")
    .option("--top <n>", "how many costliest turns to list", (v) => Number.parseInt(v, 10), 10)
    .option("--include-optimizer", "attempt to join token-optimizer-mcp's analytics by sessionId (currently reports unavailable — see docs)")
    .action(async (file: string | undefined, opts: Record<string, unknown>) => {
      const { config } = loadConfig();
      const includeOptimizer = Boolean(opts.includeOptimizer) || config.report.includeOptimizer;

      const files = resolveReportFiles(file, {
        session: opts.session as string | undefined,
        all: Boolean(opts.all),
      });

      const { stdout, stderr } = await runReportCli(files, {
        format: opts.format as string | undefined,
        range: opts.range as string | undefined,
        top: opts.top as number | undefined,
        includeOptimizer,
      });

      process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    });
}
