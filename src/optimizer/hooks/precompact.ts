// The `PreCompact` hook entry for the optimizer's enforcement layer
// (no matcher — co-registers alongside handoff's own `precompact-handoff.mjs`
// entry, which `docs/modules.md`'s Module 4 section already documents as
// safe: both may fire on the same event; this hook only ever emits
// `systemMessage`, and handoff's own PreCompact hook stores a *reference*
// to token-optimizer's state rather than anything this hook returns, so
// there is no field collision to arbitrate).
//
// Faithfully ported from
// `vendor/token-optimizer-mcp/plugin/hooks/precompact-optimize.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md), restructured to this
// repo's pure-decision + thin-wrapper hook shape — see `pretooluse.ts`'s
// header for the same restructuring rationale (no `process.exit`, deadline
// enforced by `main()` via `Promise.race` instead of a timer inside a
// library module).
//
// ONE PIECE DELIBERATELY NOT PORTED, DOCUMENTED RATHER THAN SILENTLY
// DROPPED: vendor's `main()` ends by spawning `cli-wrapper.mjs` to invoke
// `optimize_session` out-of-band, because "a hook cannot call an MCP tool
// ... [it] does the next best thing ... invoke the same underlying tool
// through the package's one-shot CLI wrapper". That constraint doesn't
// hold in this merged, single-process plugin — `optimize_session` is one
// of the already-registered `src/optimizer/tools/**` tools in the SAME
// process — but calling it in-process from here is a real design decision
// this checkpoint defers, not a trivial call-site swap: vendor's own
// comment states the hard invariant that any replacement must preserve
// ("never blocks or delays compaction: the spawn is bounded and
// fail-open"), and an in-process call into the merged optimizer's ~76
// tools can throw or block in ways a bounded subprocess spawn cannot. So
// this checkpoint neither spawns vendor's now-absent `cli-wrapper.mjs` nor
// calls `optimize_session` in-process; it stops after co-occurrence
// recording, `seen`-clearing, the recording nudge, and the forecast
// calibration close — exactly vendor's own "plugin-only install" path
// (`findWrapper()` returning null), which vendor itself treats as normal.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readHookInput, writeHookOutput, type HookOutput } from "../../core/hook-io.js";
import { mode, MODE_OFF, loadState, clearSeen } from "./lib/policy.js";
import { linkCoOccurrence } from "./lib/inject.js";
import { wikiDir, projectRootFor } from "./lib/wiki.js";
import { closeForecast } from "./lib/surface.js";
import { compactionNudge } from "./lib/recording.js";
import { optimizerToolsForHook } from "./lib/capabilities.js";
import { hookDeadlineMs } from "./lib/observability.js";

export interface PreCompactRawPayload {
  session_id?: string;
  cwd?: string;
  transcript_path?: string | null;
  [key: string]: unknown;
}

/** The decision function — no stdin/stdout/`process.exit`; see module header. */
export function decidePreCompact(raw: PreCompactRawPayload | null): HookOutput {
  if (!raw) return {};
  try {
    if (mode() === MODE_OFF) return {};

    const sessionId = raw.session_id ?? "default";
    const cwd = raw.cwd || process.cwd();
    const transcriptPath = raw.transcript_path ?? null;

    const state = loadState(sessionId, transcriptPath);
    const seen = Object.keys(state.seen || {});
    if (seen.length === 0) return {};

    // Co-occurrence, grouped by project — same grouping rule vendor uses.
    try {
      const byProject = new Map<string, string[]>();
      for (const path of seen) {
        const root = projectRootFor(path, cwd);
        if (!root) continue;
        if (!byProject.has(root)) byProject.set(root, []);
        byProject.get(root)!.push(path);
      }
      for (const [root, paths] of byProject) {
        if (paths.length < 2) continue;
        linkCoOccurrence(wikiDir(root), sessionId, paths);
      }
    } catch {
      // Bookkeeping must never delay or fail a compaction.
    }

    // Compaction ends the claim that the caller still holds these files.
    clearSeen(sessionId, transcriptPath);

    let systemMessage: string | undefined;
    try {
      const graphDir = wikiDir(projectRootFor(join(cwd, "x"), cwd) ?? cwd);
      const refreshedState = loadState(sessionId, transcriptPath);
      const tools = optimizerToolsForHook(raw, refreshedState);
      const nudge = tools.names.has("wiki_write")
        ? compactionNudge(graphDir, { edits: refreshedState.edits || 0 })
        : null;
      if (nudge) systemMessage = nudge;
    } catch {
      // Never delay compaction for a reminder.
    }

    try {
      closeForecast(wikiDir(projectRootFor(join(cwd, "x"), cwd) ?? cwd), {
        transcriptPath,
        sessionId,
      });
    } catch {
      // Scoring a forecast must never delay compaction.
    }

    // No in-process `optimize_session` call and no `cli-wrapper.mjs` spawn
    // in this checkpoint — see module header.
    return systemMessage ? { systemMessage } : {};
  } catch {
    // Compaction must proceed whatever happens here.
    return {};
  }
}

export async function runPreCompact(
  readInput: () => Promise<PreCompactRawPayload | null>
): Promise<HookOutput> {
  const raw = await readInput();
  return decidePreCompact(raw);
}

async function main(): Promise<void> {
  const deadline = new Promise<HookOutput>((resolve) => {
    setTimeout(() => resolve({}), hookDeadlineMs()).unref?.();
  });
  const output = await Promise.race([
    runPreCompact(() => readHookInput<PreCompactRawPayload>()),
    deadline,
  ]);
  writeHookOutput(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}
