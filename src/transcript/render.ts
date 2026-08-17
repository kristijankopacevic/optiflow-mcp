// Module 2: pure output formatting for `optiflow report` — `table` (human,
// default), `json` (machine-readable), `markdown` (paste into docs/PRs).
// Mirrors Module 3's pure-render precedent (`src/statusline/render.ts`):
// zero I/O here, every function is `AnalysisResult -> string`. The CLI
// (`src/cli/commands/report.ts`) owns reading files/writing stdout; this
// file never touches `node:fs`.

import type { AnalysisResult } from "./analyze.js";

export type ReportFormat = "table" | "json" | "markdown";

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function formatMaybeTimestamp(ts: string | undefined): string {
  return ts ?? "(unknown)";
}

/** Simple fixed-width column table — no external dependency, ASCII-safe. */
function renderAsciiTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const renderRow = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  return [renderRow(headers), separator, ...rows.map(renderRow)].join("\n");
}

function renderMarkdownTable(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((r) => `| ${r.join(" | ")} |`);
  return [headerLine, separatorLine, ...rowLines].join("\n");
}

export function renderJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

export function renderTable(result: AnalysisResult): string {
  const sections: string[] = [];

  sections.push(
    [
      "optiflow report",
      `  turns: ${result.turnCount} (main: ${result.mainThreadTurnCount}, subagent: ${result.sidechainTurnCount})`,
      `  total tokens: ${formatNumber(result.totals.totalTokens)}` +
        ` (input ${formatNumber(result.totals.inputTokens)}` +
        ` + cache-creation ${formatNumber(result.totals.cacheCreationTokens)}` +
        ` + cache-read ${formatNumber(result.totals.cacheReadTokens)}` +
        ` + output ${formatNumber(result.totals.outputTokens)})`,
      `  thinking tokens: ${formatNumber(result.totals.thinkingTokens)}`,
      `  cache tiers: 1h=${formatNumber(result.totals.cacheCreationEphemeral1h)}` +
        ` 5m=${formatNumber(result.totals.cacheCreationEphemeral5m)}`,
      `  cache breaks: ${result.cacheBreaks.length}`,
    ].join("\n")
  );

  if (result.sessions.length > 0) {
    sections.push(
      "\nSessions:\n" +
        renderAsciiTable(
          ["sessionId", "turns", "total", "input", "cache-creation", "cache-read", "output"],
          result.sessions.map((s) => [
            s.sessionId,
            String(s.turnCount),
            formatNumber(s.totalTokens),
            formatNumber(s.inputTokens),
            formatNumber(s.cacheCreationTokens),
            formatNumber(s.cacheReadTokens),
            formatNumber(s.outputTokens),
          ])
        )
    );
  }

  if (result.cacheBreaks.length > 0) {
    sections.push(
      "\nCache breaks:\n" +
        renderAsciiTable(
          ["thread", "timestamp", "turnId", "prevCacheTotal", "curCacheRead", "curCacheCreation"],
          result.cacheBreaks.map((b) => [
            b.thread,
            formatMaybeTimestamp(b.timestamp),
            b.turnId,
            formatNumber(b.previousCacheTotal),
            formatNumber(b.currentCacheRead),
            formatNumber(b.currentCacheCreation),
          ])
        )
    );
  }

  if (result.subagents.length > 0) {
    sections.push(
      "\nSubagents (best-effort attribution — see analyze.ts):\n" +
        renderAsciiTable(
          ["rootUuid", "turns", "total"],
          result.subagents.map((s) => [s.rootUuid, String(s.turnCount), formatNumber(s.totalTokens)])
        )
    );
  }

  if (result.topTurns.length > 0) {
    sections.push(
      `\nTop ${result.topTurns.length} costliest turns:\n` +
        renderAsciiTable(
          ["timestamp", "sessionId", "sidechain", "total", "input", "cache-creation", "cache-read", "output"],
          result.topTurns.map((t) => [
            formatMaybeTimestamp(t.timestamp),
            t.sessionId ?? "(unknown)",
            t.isSidechain ? "yes" : "no",
            formatNumber(t.totalTokens),
            formatNumber(t.inputTokens),
            formatNumber(t.cacheCreationTokens),
            formatNumber(t.cacheReadTokens),
            formatNumber(t.outputTokens),
          ])
        )
    );
  }

  return sections.join("\n");
}

export function renderMarkdown(result: AnalysisResult): string {
  const sections: string[] = [];

  sections.push(
    [
      "# optiflow report",
      "",
      `- **Turns**: ${result.turnCount} (main: ${result.mainThreadTurnCount}, subagent: ${result.sidechainTurnCount})`,
      `- **Total tokens**: ${formatNumber(result.totals.totalTokens)}` +
        ` (input ${formatNumber(result.totals.inputTokens)}` +
        ` + cache-creation ${formatNumber(result.totals.cacheCreationTokens)}` +
        ` + cache-read ${formatNumber(result.totals.cacheReadTokens)}` +
        ` + output ${formatNumber(result.totals.outputTokens)})`,
      `- **Thinking tokens**: ${formatNumber(result.totals.thinkingTokens)}`,
      `- **Cache tiers**: 1h=${formatNumber(result.totals.cacheCreationEphemeral1h)}` +
        ` 5m=${formatNumber(result.totals.cacheCreationEphemeral5m)}`,
      `- **Cache breaks**: ${result.cacheBreaks.length}`,
    ].join("\n")
  );

  if (result.sessions.length > 0) {
    sections.push(
      "\n## Sessions\n\n" +
        renderMarkdownTable(
          ["sessionId", "turns", "total", "input", "cache-creation", "cache-read", "output"],
          result.sessions.map((s) => [
            s.sessionId,
            String(s.turnCount),
            formatNumber(s.totalTokens),
            formatNumber(s.inputTokens),
            formatNumber(s.cacheCreationTokens),
            formatNumber(s.cacheReadTokens),
            formatNumber(s.outputTokens),
          ])
        )
    );
  }

  if (result.cacheBreaks.length > 0) {
    sections.push(
      "\n## Cache breaks\n\n" +
        renderMarkdownTable(
          ["thread", "timestamp", "turnId", "prevCacheTotal", "curCacheRead", "curCacheCreation"],
          result.cacheBreaks.map((b) => [
            b.thread,
            formatMaybeTimestamp(b.timestamp),
            b.turnId,
            formatNumber(b.previousCacheTotal),
            formatNumber(b.currentCacheRead),
            formatNumber(b.currentCacheCreation),
          ])
        )
    );
  }

  if (result.subagents.length > 0) {
    sections.push(
      "\n## Subagents (best-effort attribution)\n\n" +
        renderMarkdownTable(
          ["rootUuid", "turns", "total"],
          result.subagents.map((s) => [s.rootUuid, String(s.turnCount), formatNumber(s.totalTokens)])
        )
    );
  }

  if (result.topTurns.length > 0) {
    sections.push(
      `\n## Top ${result.topTurns.length} costliest turns\n\n` +
        renderMarkdownTable(
          ["timestamp", "sessionId", "sidechain", "total", "input", "cache-creation", "cache-read", "output"],
          result.topTurns.map((t) => [
            formatMaybeTimestamp(t.timestamp),
            t.sessionId ?? "(unknown)",
            t.isSidechain ? "yes" : "no",
            formatNumber(t.totalTokens),
            formatNumber(t.inputTokens),
            formatNumber(t.cacheCreationTokens),
            formatNumber(t.cacheReadTokens),
            formatNumber(t.outputTokens),
          ])
        )
    );
  }

  return sections.join("\n");
}

/** Dispatches to the right pure renderer for `format`. */
export function renderReport(result: AnalysisResult, format: ReportFormat): string {
  switch (format) {
    case "json":
      return renderJson(result);
    case "markdown":
      return renderMarkdown(result);
    case "table":
    default:
      return renderTable(result);
  }
}
