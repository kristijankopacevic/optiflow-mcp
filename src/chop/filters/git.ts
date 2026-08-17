// Filter for `git` output. Human-readable `git status` output is the
// primary target (per the plan's own worked example: "for git status with
// 200 untracked files: counts + a few examples, not all 200 lines"). Other
// `git` subcommands (`log`, `diff`, `show`, ...) fall back to the generic
// line-oriented head+tail truncation, since their output isn't reliably
// structured enough to special-case safely.

import { genericFilter } from "./generic.js";
import type { FilterInput, FilterOutput } from "./types.js";

const MAX_EXAMPLES_PER_SECTION = 5;

interface Section {
  /** The section header line, verbatim (kept in the output). */
  header: string;
  /** File entry lines belonging to this section (already trimmed). */
  files: string[];
}

// `git status`'s three human-readable section headers. Matched as a plain
// prefix, not a strict full-line match, so trailing punctuation/whitespace
// variations across git versions don't break detection.
const SECTION_HEADERS = [
  "Changes to be committed:",
  "Changes not staged for commit:",
  "Untracked files:",
];

function isSectionHeader(line: string): boolean {
  return SECTION_HEADERS.some((header) => line.trim().startsWith(header));
}

/** A `git status` file entry line looks like `\tmodified:   path` or `\tpath`. */
function isFileEntryLine(line: string): boolean {
  return /^\s+\S/.test(line) && !line.trim().startsWith("(use ");
}

function parseStatusSections(stdout: string): Section[] | null {
  const lines = stdout.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (isSectionHeader(line)) {
      if (current) sections.push(current);
      current = { header: line.trimEnd(), files: [] };
      continue;
    }
    if (current && isFileEntryLine(line)) {
      current.files.push(line.trim());
    } else if (current && line.trim().length === 0) {
      // Blank line ends the current section's file list (but the section
      // itself is still recorded above).
      sections.push(current);
      current = null;
    }
  }
  if (current) sections.push(current);
  return sections.length > 0 ? sections : null;
}

function summarizeStatus(stdout: string, sections: Section[]): string {
  const lines = stdout.split("\n");
  const preamble: string[] = [];
  for (const line of lines) {
    if (isSectionHeader(line)) break;
    preamble.push(line);
  }

  const out: string[] = [...preamble];
  for (const section of sections) {
    out.push(section.header);
    const examples = section.files.slice(0, MAX_EXAMPLES_PER_SECTION);
    for (const example of examples) out.push(`\t${example}`);
    if (section.files.length > MAX_EXAMPLES_PER_SECTION) {
      out.push(`\t... and ${section.files.length - MAX_EXAMPLES_PER_SECTION} more`);
    }
    out.push(`\t(${section.files.length} total in this section)`);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// Global `git` flags that take a separate value argument (so the token
// right after them must be skipped when scanning for the subcommand, e.g.
// `git -C /some/path status` — the subcommand is `status`, not `/some/path`
// or `-C`). Not an exhaustive list of every git global flag; covers the
// common ones an agent might realistically prepend. KNOWN LIMITATION: an
// unlisted value-taking flag would cause its value to be misidentified as
// the subcommand, falling through to the generic filter instead of the
// `status`-specific one — a missed optimization, never an incorrect one.
const GLOBAL_FLAGS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix"]);

/** Finds the actual subcommand (e.g. `status`) even with global flags before it. */
function findSubcommand(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("-")) return arg;
    if (GLOBAL_FLAGS_WITH_VALUE.has(arg)) i++; // skip this flag's value too
  }
  return undefined;
}

export function gitFilter(input: FilterInput): FilterOutput {
  const subcommand = findSubcommand(input.args);
  if (subcommand === "status") {
    const sections = parseStatusSections(input.stdout);
    if (sections) {
      const totalFiles = sections.reduce((sum, s) => sum + s.files.length, 0);
      return {
        text: summarizeStatus(input.stdout, sections),
        formatHint: "plain",
        meta: {
          sections: sections.map((s) => ({ header: s.header, count: s.files.length })),
          totalFiles,
        },
      };
    }
  }
  // Any other git subcommand (log, diff, show, blame, ...): generic
  // line-oriented truncation is the safest default — git's non-status
  // output has too many shapes to special-case reliably.
  return genericFilter(input);
}
