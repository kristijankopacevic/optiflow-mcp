// The `SessionStart` hook entry for Module 4: re-injects the most recent
// checkpoint after a compaction.
//
// Checkpoints have been written on `PreCompact` and `SessionEnd` since
// Module 4 landed, but nothing ever read them back automatically -- the
// only consumer was `/optiflow:restore`, run by hand. So the one moment a
// checkpoint exists precisely to survive (a `/compact`, which is exactly
// when the model loses the context the checkpoint recorded) passed with the
// checkpoint sitting unread on disk. `SessionStart` is the one documented
// context-re-injection idiom, and it was absent from `plugin/hooks/hooks.json`.
//
// Registered with `"matcher": "compact"` ONLY, deliberately. A `startup`
// or `resume` match would re-inject a checkpoint into a session that never
// lost anything, spending real tokens to tell the model things it already
// knows -- and on `startup` the "most recent checkpoint" is likely from an
// unrelated earlier session in the same project.
//
// Emits `additionalContext` with NO permission decision (see
// `withAdditionalContext` in src/core/hook-io.ts): `SessionStart` has no
// tool call to allow or deny.
//
// Fail-open like every other hook here: any failure returns a bare `{}`, so
// a session start is never blocked by a checkpoint that won't load.

import { pathToFileURL } from "node:url";
import { readHookInput, withAdditionalContext, writeHookOutput, type HookOutput } from "../core/hook-io.js";
import { loadConfig } from "../config/load.js";
import { resolveCheckpointDir } from "./checkpoint.js";
import { renderRestoreMarkdown, resolveCheckpoint } from "./restore.js";

export interface SessionStartHookInput {
  session_id?: string;
  cwd?: string;
  /** `startup` | `resume` | `compact` | `clear` — only `compact` is acted on. */
  source?: string;
}

/**
 * Injected context is capped well below `writeHookOutput`'s own 10,000-char
 * envelope cap. Re-injection is only worth doing if it costs less than the
 * work it saves, and a checkpoint summary that runs to 10K characters has
 * stopped being a summary. `renderRestoreMarkdown`'s own truncation marker
 * makes the elision visible to the model rather than silent.
 */
const RESTORE_CONTEXT_CAP_CHARS = 4_000;

export async function runSessionStartHook(
  readInput: () => Promise<SessionStartHookInput | null>,
  loadOptions: { cwd?: string; home?: string } = {}
): Promise<HookOutput> {
  try {
    const input = await readInput();
    if (!input) return {};

    // Belt and braces: hooks.json already matches only `compact`, but a
    // user editing their own settings.json could register this hook more
    // broadly, and re-injecting on every startup is a real token cost.
    if (input.source !== "compact") return {};

    const { config } = loadConfig(loadOptions);
    if (!config.handoff.enabled) return {};

    const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
    const dir = resolveCheckpointDir({ cwd, home: loadOptions.home });
    const checkpoint = resolveCheckpoint(dir);

    // No checkpoint is the normal case for a project that has never
    // compacted. Emit nothing at all rather than a "no checkpoint found"
    // note, which would be pure cost.
    if (!checkpoint) return {};

    const markdown = renderRestoreMarkdown(checkpoint, { capChars: RESTORE_CONTEXT_CAP_CHARS });
    return withAdditionalContext("SessionStart", markdown);
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const output = await runSessionStartHook(() => readHookInput<SessionStartHookInput>());
  writeHookOutput(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}
