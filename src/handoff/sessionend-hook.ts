// The `SessionEnd` hook entry for Module 4: auto-checkpoints session state
// when a session ends (so `/optiflow:restore` has something to resume from
// even if the session never hit a `PreCompact` event). Not present in the
// vendored token-optimizer-mcp's own `hooks.json` (it registers
// `SessionStart`/`PreToolUse`/`PreCompact`/`PostToolUse`/`Stop` only, no
// `SessionEnd`) — so there is no co-registration concern for this event.
//
// Same fail-open and field-provenance rules as `precompact-hook.ts` apply
// here (see its module header) — a session ending must never be blocked or
// delayed by a checkpoint write failing. Unlike `PreCompact`, there is no
// user-visible surface left to show a `systemMessage` in (the session is
// already ending), so this always returns a bare `{}` regardless of outcome
// — the checkpoint write is a pure side effect.

import { pathToFileURL } from "node:url";
import { readHookInput, writeHookOutput, type HookOutput } from "../core/hook-io.js";
import { loadConfig } from "../config/load.js";
import { createCheckpoint, type ModelLike } from "./checkpoint.js";

export interface SessionEndHookInput {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  reason?: string;
  model?: ModelLike;
}

export async function runSessionEndHook(
  readInput: () => Promise<SessionEndHookInput | null>,
  loadOptions: { cwd?: string; home?: string } = {}
): Promise<HookOutput> {
  try {
    const input = await readInput();
    if (!input) return {};

    const { config } = loadConfig(loadOptions);
    if (!config.handoff.enabled) return {};

    const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : "unknown-session";
    const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();

    createCheckpoint(
      { sessionId, cwd, model: input.model, openFiles: [], decisions: [], nextSteps: [] },
      loadOptions
    );

    return {};
  } catch {
    // Session end must never be blocked by a checkpoint write failing.
    return {};
  }
}

async function main(): Promise<void> {
  const output = await runSessionEndHook(() => readHookInput<SessionEndHookInput>());
  writeHookOutput(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}
