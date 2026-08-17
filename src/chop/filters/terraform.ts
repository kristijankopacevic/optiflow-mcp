// Filter for `terraform` output. Targets `terraform plan`/`terraform
// apply`-style output: per the plan, "resource-change counts + first N
// lines of diffs, not the full plan". The `Plan: X to add, Y to change, Z
// to destroy.` summary line is always preserved verbatim regardless of
// where it falls in the output (terraform sometimes prints trailing
// `Changes to Outputs:` / warning blocks after it), since it's the single
// most load-bearing line for an agent deciding what a plan will do.

import type { FilterInput, FilterOutput } from "./types.js";

const PLAN_SUMMARY_PATTERN = /^Plan:\s+\d+ to add,\s+\d+ to change,\s+\d+ to destroy\.$/;
const NO_CHANGES_PATTERN = /^No changes\./;
const RESOURCE_HEADER_PATTERN = /^\s{2}#\s.+\s(will be (created|destroyed|updated in-place|replaced)|must be replaced)/;

const MAX_BODY_LINES_PER_RESOURCE = 6;

function findSummaryLine(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (PLAN_SUMMARY_PATTERN.test(trimmed) || NO_CHANGES_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Splits the plan body into per-resource blocks (each starting at a
 * `  # <address> will be ...` header line) and truncates each block's body
 * to the first `MAX_BODY_LINES_PER_RESOURCE` lines, preserving the header
 * and a per-block omitted-line count.
 */
function truncateResourceBlocks(lines: string[]): { text: string; resourceCount: number } {
  const out: string[] = [];
  let resourceCount = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (RESOURCE_HEADER_PATTERN.test(line)) {
      resourceCount++;
      out.push(line);
      i++;
      const blockLines: string[] = [];
      // A resource block ends at the next resource header, a blank line
      // followed by another header, or the summary line — collect until
      // one of those, or a blank line that isn't immediately followed by
      // more of the same block (terraform blocks are separated by a single
      // blank line).
      while (i < lines.length && !RESOURCE_HEADER_PATTERN.test(lines[i]) && !PLAN_SUMMARY_PATTERN.test(lines[i].trim())) {
        blockLines.push(lines[i]);
        i++;
      }
      // Trim trailing blank lines from the block before deciding truncation.
      while (blockLines.length > 0 && blockLines[blockLines.length - 1].trim() === "") {
        blockLines.pop();
      }
      if (blockLines.length > MAX_BODY_LINES_PER_RESOURCE) {
        out.push(...blockLines.slice(0, MAX_BODY_LINES_PER_RESOURCE));
        out.push(`      ... [${blockLines.length - MAX_BODY_LINES_PER_RESOURCE} lines omitted] ...`);
      } else {
        out.push(...blockLines);
      }
      out.push("");
      continue;
    }
    out.push(line);
    i++;
  }
  return { text: out.join("\n"), resourceCount };
}

export function terraformFilter(input: FilterInput): FilterOutput {
  const lines = input.stdout.split("\n");
  const summary = findSummaryLine(lines);
  const { text: truncatedBody, resourceCount } = truncateResourceBlocks(lines);

  let text = truncatedBody.replace(/\n{3,}/g, "\n\n").trim();
  if (summary && !text.includes(summary)) {
    // Guard against the (should-be-impossible, since the summary line
    // itself stops block collection above) case where the summary line got
    // swallowed into a truncated block — always surface it explicitly.
    text += `\n\n${summary}`;
  }
  text += "\n";

  return {
    text,
    formatHint: "plain",
    meta: { resourceCount, summary },
  };
}
