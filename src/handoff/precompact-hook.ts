// The `PreCompact` hook entry for Module 4: auto-checkpoints session state
// right before Claude Code discards context to compact.
//
// FIELD PROVENANCE (checked against the vendored token-optimizer-mcp's own
// real PreCompact hook, `vendor/token-optimizer-mcp/plugin/hooks/
// precompact-optimize.mjs`, which reads `payload.session_id`, `payload.cwd`,
// and `payload.transcript_path` — the only fields this hook input interface
// below claims): `session_id`/`cwd`/`transcript_path` are genuinely present
// on a real PreCompact payload; `model` is NOT a documented field on this
// event (the vendored code only ever reads a `model` field defensively,
// with heavy fallback chains, from unrelated payload shapes — see
// `vendor/token-optimizer-mcp/plugin/hooks/lib/experiment.mjs`) — treat it
// as usually absent; `checkpoint.ts`'s `normalizeModel` handles that.
//
// FAIL-OPEN, ALWAYS: compaction must proceed no matter what happens here
// (same philosophy the vendored `precompact-optimize.mjs` states explicitly
// in its own header) — every failure mode below resolves to a bare `{}`,
// never a thrown error or a blocked compaction.
//
// `openFiles`/`decisions`/`nextSteps` are always `[]` here — see
// `checkpoint.ts`'s module header on why a hook payload alone can never
// supply free-text reasoning; only the manual `/optiflow:checkpoint [notes]`
// path populates those.

import { pathToFileURL } from "node:url";
import { readHookInput, writeHookOutput, type HookOutput } from "../core/hook-io.js";
import { loadConfig } from "../config/load.js";
import { createCheckpoint, type ModelLike } from "./checkpoint.js";

export interface PreCompactHookInput {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  trigger?: "manual" | "auto";
  model?: ModelLike;
}

export async function runPreCompactHook(
  readInput: () => Promise<PreCompactHookInput | null>,
  loadOptions: { cwd?: string; home?: string } = {}
): Promise<HookOutput> {
  try {
    const input = await readInput();
    if (!input) return {};

    const { config } = loadConfig(loadOptions);
    if (!config.handoff.enabled) return {};

    const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : "unknown-session";
    const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();

    const { write } = createCheckpoint(
      { sessionId, cwd, model: input.model, openFiles: [], decisions: [], nextSteps: [] },
      loadOptions
    );

    return {
      systemMessage: `optiflow: checkpoint saved (${write.id}) before compaction. Run /optiflow:restore to resume, or /optiflow:compact-continue for a combined checkpoint + resume summary.`,
    };
  } catch {
    // Compaction must proceed whatever happens here.
    return {};
  }
}

async function main(): Promise<void> {
  const output = await runPreCompactHook(() => readHookInput<PreCompactHookInput>());
  writeHookOutput(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}
