// Filter for `npm` output (excluding `npm run build`/`npm test`, which
// `chop.excludeCommands` keeps out of this module entirely — see
// allowlist.ts). Targets `npm install`/`npm ci`/`npm update`-style output:
// a burst of `npm warn deprecated ...` lines an agent rarely needs
// individually, followed by the summary lines it actually needs (package
// counts, funding notice, vulnerability summary, audit-fix hint).

import type { FilterInput, FilterOutput } from "./types.js";

const MAX_WARN_EXAMPLES = 3;

const SUMMARY_LINE_PATTERNS = [
  /^added \d+ packages?/i,
  /^removed \d+ packages?/i,
  /^changed \d+ packages?/i,
  /^up to date/i,
  /^\d+ packages? (are|is) looking for funding/i,
  /^\d+ vulnerabilit(y|ies)/i,
  /^found \d+ vulnerabilit/i,
  /^run `npm (fund|audit)/i,
  /^to address (all issues|.*vulnerabilit)/i,
];

function isDeprecationWarning(line: string): boolean {
  return /^npm warn deprecated/i.test(line.trim());
}

function isSummaryLine(line: string): boolean {
  return SUMMARY_LINE_PATTERNS.some((pattern) => pattern.test(line.trim()));
}

export function npmFilter(input: FilterInput): FilterOutput {
  const lines = input.stdout.split("\n");
  const deprecationWarnings = lines.filter(isDeprecationWarning);
  const kept: string[] = [];

  for (const line of lines) {
    if (isDeprecationWarning(line)) continue; // handled as a summarized block below
    kept.push(line);
  }

  if (deprecationWarnings.length > 0) {
    const examples = deprecationWarnings.slice(0, MAX_WARN_EXAMPLES);
    const summaryBlock = [
      ...examples,
      deprecationWarnings.length > MAX_WARN_EXAMPLES
        ? `npm warn ... and ${deprecationWarnings.length - MAX_WARN_EXAMPLES} more deprecation warnings (${deprecationWarnings.length} total)`
        : null,
    ].filter((line): line is string => line !== null);
    kept.unshift(...summaryBlock, "");
  }

  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const hasSummary = lines.some(isSummaryLine);

  return {
    text,
    formatHint: "plain",
    meta: {
      deprecationWarningsOmitted: Math.max(0, deprecationWarnings.length - MAX_WARN_EXAMPLES),
      hasSummary,
    },
  };
}
