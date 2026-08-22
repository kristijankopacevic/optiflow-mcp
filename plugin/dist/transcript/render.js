import { createRequire as __optiflowCreateRequire } from "node:module";
import { fileURLToPath as __optiflowFileURLToPath } from "node:url";
import { dirname as __optiflowDirname } from "node:path";
const require = __optiflowCreateRequire(import.meta.url);
const __filename = __optiflowFileURLToPath(import.meta.url);
const __dirname = __optiflowDirname(__filename);

// src/transcript/render.ts
function formatNumber(n) {
  return Math.round(n).toLocaleString("en-US");
}
function formatMaybeTimestamp(ts) {
  return ts ?? "(unknown)";
}
function renderAsciiTable(headers, rows) {
  const widths = headers.map(
    (h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const renderRow = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  return [renderRow(headers), separator, ...rows.map(renderRow)].join("\n");
}
function renderMarkdownTable(headers, rows) {
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((r) => `| ${r.join(" | ")} |`);
  return [headerLine, separatorLine, ...rowLines].join("\n");
}
function renderJson(result) {
  return JSON.stringify(result, null, 2);
}
function renderTable(result) {
  const sections = [];
  sections.push(
    [
      "optiflow report",
      `  turns: ${result.turnCount} (main: ${result.mainThreadTurnCount}, subagent: ${result.sidechainTurnCount})`,
      `  total tokens: ${formatNumber(result.totals.totalTokens)} (input ${formatNumber(result.totals.inputTokens)} + cache-creation ${formatNumber(result.totals.cacheCreationTokens)} + cache-read ${formatNumber(result.totals.cacheReadTokens)} + output ${formatNumber(result.totals.outputTokens)})`,
      `  thinking tokens: ${formatNumber(result.totals.thinkingTokens)}`,
      `  cache tiers: 1h=${formatNumber(result.totals.cacheCreationEphemeral1h)} 5m=${formatNumber(result.totals.cacheCreationEphemeral5m)}`,
      `  cache breaks: ${result.cacheBreaks.length}`
    ].join("\n")
  );
  if (result.sessions.length > 0) {
    sections.push(
      "\nSessions:\n" + renderAsciiTable(
        ["sessionId", "turns", "total", "input", "cache-creation", "cache-read", "output"],
        result.sessions.map((s) => [
          s.sessionId,
          String(s.turnCount),
          formatNumber(s.totalTokens),
          formatNumber(s.inputTokens),
          formatNumber(s.cacheCreationTokens),
          formatNumber(s.cacheReadTokens),
          formatNumber(s.outputTokens)
        ])
      )
    );
  }
  if (result.cacheBreaks.length > 0) {
    sections.push(
      "\nCache breaks:\n" + renderAsciiTable(
        ["thread", "timestamp", "turnId", "prevCacheTotal", "curCacheRead", "curCacheCreation"],
        result.cacheBreaks.map((b) => [
          b.thread,
          formatMaybeTimestamp(b.timestamp),
          b.turnId,
          formatNumber(b.previousCacheTotal),
          formatNumber(b.currentCacheRead),
          formatNumber(b.currentCacheCreation)
        ])
      )
    );
  }
  if (result.subagents.length > 0) {
    sections.push(
      "\nSubagents (best-effort attribution \u2014 see analyze.ts):\n" + renderAsciiTable(
        ["rootUuid", "turns", "total"],
        result.subagents.map((s) => [s.rootUuid, String(s.turnCount), formatNumber(s.totalTokens)])
      )
    );
  }
  if (result.topTurns.length > 0) {
    sections.push(
      `
Top ${result.topTurns.length} costliest turns:
` + renderAsciiTable(
        ["timestamp", "sessionId", "sidechain", "total", "input", "cache-creation", "cache-read", "output"],
        result.topTurns.map((t) => [
          formatMaybeTimestamp(t.timestamp),
          t.sessionId ?? "(unknown)",
          t.isSidechain ? "yes" : "no",
          formatNumber(t.totalTokens),
          formatNumber(t.inputTokens),
          formatNumber(t.cacheCreationTokens),
          formatNumber(t.cacheReadTokens),
          formatNumber(t.outputTokens)
        ])
      )
    );
  }
  return sections.join("\n");
}
function renderMarkdown(result) {
  const sections = [];
  sections.push(
    [
      "# optiflow report",
      "",
      `- **Turns**: ${result.turnCount} (main: ${result.mainThreadTurnCount}, subagent: ${result.sidechainTurnCount})`,
      `- **Total tokens**: ${formatNumber(result.totals.totalTokens)} (input ${formatNumber(result.totals.inputTokens)} + cache-creation ${formatNumber(result.totals.cacheCreationTokens)} + cache-read ${formatNumber(result.totals.cacheReadTokens)} + output ${formatNumber(result.totals.outputTokens)})`,
      `- **Thinking tokens**: ${formatNumber(result.totals.thinkingTokens)}`,
      `- **Cache tiers**: 1h=${formatNumber(result.totals.cacheCreationEphemeral1h)} 5m=${formatNumber(result.totals.cacheCreationEphemeral5m)}`,
      `- **Cache breaks**: ${result.cacheBreaks.length}`
    ].join("\n")
  );
  if (result.sessions.length > 0) {
    sections.push(
      "\n## Sessions\n\n" + renderMarkdownTable(
        ["sessionId", "turns", "total", "input", "cache-creation", "cache-read", "output"],
        result.sessions.map((s) => [
          s.sessionId,
          String(s.turnCount),
          formatNumber(s.totalTokens),
          formatNumber(s.inputTokens),
          formatNumber(s.cacheCreationTokens),
          formatNumber(s.cacheReadTokens),
          formatNumber(s.outputTokens)
        ])
      )
    );
  }
  if (result.cacheBreaks.length > 0) {
    sections.push(
      "\n## Cache breaks\n\n" + renderMarkdownTable(
        ["thread", "timestamp", "turnId", "prevCacheTotal", "curCacheRead", "curCacheCreation"],
        result.cacheBreaks.map((b) => [
          b.thread,
          formatMaybeTimestamp(b.timestamp),
          b.turnId,
          formatNumber(b.previousCacheTotal),
          formatNumber(b.currentCacheRead),
          formatNumber(b.currentCacheCreation)
        ])
      )
    );
  }
  if (result.subagents.length > 0) {
    sections.push(
      "\n## Subagents (best-effort attribution)\n\n" + renderMarkdownTable(
        ["rootUuid", "turns", "total"],
        result.subagents.map((s) => [s.rootUuid, String(s.turnCount), formatNumber(s.totalTokens)])
      )
    );
  }
  if (result.topTurns.length > 0) {
    sections.push(
      `
## Top ${result.topTurns.length} costliest turns

` + renderMarkdownTable(
        ["timestamp", "sessionId", "sidechain", "total", "input", "cache-creation", "cache-read", "output"],
        result.topTurns.map((t) => [
          formatMaybeTimestamp(t.timestamp),
          t.sessionId ?? "(unknown)",
          t.isSidechain ? "yes" : "no",
          formatNumber(t.totalTokens),
          formatNumber(t.inputTokens),
          formatNumber(t.cacheCreationTokens),
          formatNumber(t.cacheReadTokens),
          formatNumber(t.outputTokens)
        ])
      )
    );
  }
  return sections.join("\n");
}
function renderReport(result, format) {
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
export {
  renderJson,
  renderMarkdown,
  renderReport,
  renderTable
};
//# sourceMappingURL=render.js.map
