// Filter for test runner output (jest, vitest, pytest, `go test`). Per the
// plan: "pass/fail counts + only the failing test names/output, not full
// passing output." Individually listed passing files/tests are always
// dropped down to a count; failing files/tests and their detail are always
// kept verbatim, on the principle that failure detail is the one thing this
// filter must never compress away (unlike every other filter in this
// module, where the default posture is "compress unless it's the
// diagnostic payload" — for test runners, failure output IS the payload).

import type { FilterInput, FilterOutput } from "./types.js";

const PASS_FILE_LINE = /^PASS\s+\S/;
const FAIL_FILE_LINE = /^FAIL\s+\S/;
const PYTEST_FAILED_LINE = /^FAILED\s+\S+::/;
const GO_FAIL_LINE = /^(FAIL\b|--- FAIL:)/;
const GO_OK_LINE = /^ok\s+\S/;

const SUMMARY_LINE_PATTERNS = [
  /^Test Suites:/,
  /^Tests:/,
  /^Snapshots:/,
  /^Time:/,
  /^Ran all test suites/,
  /^Test Files\s/,
  /^Tests\s+\d/,
  /^Duration\s/,
  /^=+.*\b(passed|failed|error)\b.*=+$/i,
];

function isSummaryLine(line: string): boolean {
  return SUMMARY_LINE_PATTERNS.some((pattern) => pattern.test(line.trim()));
}

function summaryIndicatesFailure(summaryLines: string[]): boolean {
  return summaryLines.some((line) => {
    const match = line.match(/(\d+)\s+failed/i);
    return match !== null && Number(match[1]) > 0;
  });
}

/**
 * Extracts jest-style multi-line failure blocks (each starts with a line
 * whose trimmed text begins with `●`, and runs until the next `PASS `/
 * `FAIL `/summary line or another `●` block).
 */
function extractBulletBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBulletStart = trimmed.startsWith("●"); // "●"
    const isTerminator =
      PASS_FILE_LINE.test(trimmed) || FAIL_FILE_LINE.test(trimmed) || isSummaryLine(line);

    if (isBulletStart) {
      if (current) blocks.push(current);
      current = [line];
      continue;
    }
    if (isTerminator) {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

export function testrunnerFilter(input: FilterInput): FilterOutput {
  const lines = input.stdout.split("\n");

  const passFileLines = lines.filter((l) => PASS_FILE_LINE.test(l.trim()));
  // A single ordered pass, not several independently-filtered arrays that
  // can overlap: `FAIL_FILE_LINE`/`PYTEST_FAILED_LINE`/`GO_FAIL_LINE` are
  // not mutually exclusive (e.g. a go test failure summary line like
  // `FAIL    example.com/pkg/c   0.003s` matches both the generic
  // jest/vitest `FAIL ` pattern and the go-specific pattern) — filtering
  // each category separately and concatenating would print such a line
  // twice.
  const failureIndicatorLines = lines.filter(
    (l) => FAIL_FILE_LINE.test(l.trim()) || PYTEST_FAILED_LINE.test(l.trim()) || GO_FAIL_LINE.test(l.trim())
  );
  const failFileLines = lines.filter((l) => FAIL_FILE_LINE.test(l.trim()));
  const goOkLines = lines.filter((l) => GO_OK_LINE.test(l.trim()));
  const summaryLines = lines.filter(isSummaryLine);
  const bulletBlocks = extractBulletBlocks(lines);

  const hasFailures =
    failureIndicatorLines.length > 0 || bulletBlocks.length > 0 || summaryIndicatesFailure(summaryLines);

  const out: string[] = [];

  if (!hasFailures) {
    if (passFileLines.length > 0) {
      out.push(`${passFileLines.length} test file(s) passed (individual output omitted)`);
    }
    if (goOkLines.length > 0) {
      out.push(`${goOkLines.length} go package(s) ok (individual output omitted)`);
    }
    out.push(...summaryLines);
    return {
      text: out.join("\n").trim() + "\n",
      formatHint: "plain",
      meta: { hasFailures: false, passedFiles: passFileLines.length },
    };
  }

  if (passFileLines.length > 0) {
    out.push(`${passFileLines.length} test file(s) passed (individual output omitted)`);
  }
  out.push(...failureIndicatorLines);
  for (const block of bulletBlocks) {
    out.push("");
    out.push(...block);
  }
  out.push("");
  out.push(...summaryLines);

  return {
    text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n",
    formatHint: "plain",
    meta: {
      hasFailures: true,
      passedFiles: passFileLines.length,
      failedFiles: failFileLines.length,
      failureBlocks: bulletBlocks.length,
    },
  };
}
