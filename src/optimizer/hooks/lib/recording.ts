// Pressure to record a durable finding, at the moment a conclusion exists
// to record (write-side nudge, distinct from the read-side enforcement).
//
// Faithfully ported from
// `vendor/token-optimizer-mcp/plugin/hooks/lib/recording.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md). Fully self-contained
// (reads `graph.jsonl` directly), so ported verbatim; only
// `semanticHarvestPrompt` is omitted (Stop-hook-only, unreachable from the
// two hooks this tree ports).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Edits in one session before an empty graph is worth mentioning. */
export const NUDGE_AFTER_EDITS = Number(process.env.TOKEN_OPTIMIZER_NUDGE_AFTER) || 8;

/** Tools that mean a decision was made, rather than that something was looked at. */
const SUBSTANTIVE = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** Does this tool call represent work worth having a conclusion about? */
export function isSubstantive(toolName: unknown): boolean {
  return SUBSTANTIVE.has(String(toolName || ""));
}

/** How many findings this project's graph holds, counted from the durable log (not a compacted view). */
export function findingCount(dir: string): number {
  const path = join(dir, "graph.jsonl");
  if (!existsSync(path)) return 0;

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return 0;
  }

  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const node = JSON.parse(line);
      if (node?.kind === "finding" && node.id) seen.add(node.id);
    } catch {
      // A torn line costs a count, not the hook.
    }
  }
  return seen.size;
}

/** The nudge, or null. Fires once, after real work, on a project that has learned nothing. */
export function recordingNudge(
  dir: string,
  { state = {}, edits = 0, files = [] }: { state?: { recordingNudged?: boolean }; edits?: number; files?: string[] } = {}
): string | null {
  if (state.recordingNudged) return null;
  if (edits < NUDGE_AFTER_EDITS) return null;
  if (findingCount(dir) > 0) return null;

  const named = [...new Set(files)].slice(0, 3);
  const subject = named.length ? named.map((f) => f.split(/[\\/]/).pop()).join(", ") : "this project";

  return (
    `You have made ${edits} edits this session (${subject}) and this project's graph holds no ` +
    "findings at all -- so the next session starts from nothing and re-derives whatever you have " +
    "worked out. Call wiki_write for anything durable you concluded: a dead end and why, a " +
    "decision and what you rejected, a command that finally worked. Anchor it to the file it is " +
    "about. Not worth recording: what the code plainly says."
  );
}

/** The same question at PreCompact, where the answer is about to be lost. Not gated on `recordingNudged`. */
export function compactionNudge(dir: string, { edits = 0 }: { edits?: number } = {}): string | null {
  if (edits < 1) return null;
  if (findingCount(dir) > 0) return null;
  return (
    "Compaction is about to discard this session's reasoning, and nothing was recorded to the " +
    "graph. If you concluded anything durable -- a dead end, a decision and its rejected " +
    "alternative, an invocation that worked -- call wiki_write with a file anchor before it goes."
  );
}
