// `optiflow ccr-retrieve <hash>` — Phase 5c's CCR retrieval entry point.
//
// Why a CLI command (not an MCP tool): the task that added this command's
// file scope explicitly excludes touching `src/optimizer/tools/**` (the 76
// already-merged token-optimizer MCP tools) beyond `smart-read.ts`
// specifically — adding a new tool file there would be an unapproved scope
// expansion. A CLI command needs no such file; it's the one retrieval
// surface fully inside this task's ownership, and it mirrors `toon.ts`'s
// exact pattern (thin commander wiring plus a directly-testable pure-ish
// core, `runCcrRetrieveCli`, that never touches `process.argv`/real stdout).
// An MCP tool wrapping the same `getCcr` lookup would be a natural,
// low-risk follow-up (Claude could call it directly instead of shelling out
// via the Bash tool to run this command) — flagged here explicitly as a
// deliberate scope boundary, not a "forgot about it" gap.
//
// Before this command existed, a `<<ccr:HASH ...>>` marker in a hook's
// output was a dangling reference: `src/native/ccr-store.ts` could store
// `hash -> original content`, but nothing let a user or Claude actually
// read it back. This closes that loop.

import type { Command } from "commander";
import { getCcr } from "../../native/ccr-store.js";

export interface CcrRetrieveCliResult {
  /** What should be written to stdout on success: the original content, verbatim. */
  stdout: string;
  /** What should be written to stderr: empty on success, a clear message on a miss. */
  stderr: string;
  /** True if `hash` resolved to stored content. */
  found: boolean;
}

const HASH_RE = /^[0-9a-f]{12}$/;

/** Pure core of the `ccr-retrieve` CLI command — no process.argv/real stdout, directly testable. */
export function runCcrRetrieveCli(hash: string, options: { home?: string } = {}): CcrRetrieveCliResult {
  if (!HASH_RE.test(hash)) {
    return {
      stdout: "",
      stderr:
        `[optiflow ccr-retrieve] "${hash}" doesn't look like a CCR marker hash ` +
        `(expected 12 lowercase hex characters, e.g. the HASH in a <<ccr:HASH ...>> marker).\n`,
      found: false,
    };
  }

  const content = getCcr(hash, { home: options.home });
  if (content === undefined) {
    return {
      stdout: "",
      stderr:
        `[optiflow ccr-retrieve] no stored content found for hash "${hash}". It may never have been ` +
        `stored (SmartCrusher wasn't wired into the path that produced it), or the CCR store file was ` +
        `cleared.\n`,
      found: false,
    };
  }

  return { stdout: content, stderr: "", found: true };
}

export function registerCcrRetrieveCommand(program: Command): void {
  program
    .command("ccr-retrieve <hash>")
    .description(
      "Retrieve the original content a SmartCrusher <<ccr:HASH ...>> marker refers to, by its 12-character hex hash."
    )
    .action((hash: string) => {
      const result = runCcrRetrieveCli(hash);
      if (result.found) {
        process.stdout.write(result.stdout);
      } else {
        process.stderr.write(result.stderr);
        process.exitCode = 1;
      }
    });
}
