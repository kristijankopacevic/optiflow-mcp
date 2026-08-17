// The `PreToolUse` hook entry that produces the activity beacon (see
// `activity.ts`'s module header for the full "why a new hook, not
// piggybacking on `src/chop/pretooluse.ts`" reasoning). Registered in
// `plugin/hooks/hooks.json` with a broad matcher (`".*"` — the same regex
// wildcard convention this repo's own `hooks.json` already uses for
// `posttooluse-mcp.mjs`'s `"mcp__.*"` matcher, not a guess at Claude Code's
// matcher syntax) so it fires for every tool, not just `Bash`.
//
// ALWAYS emits a bare `{}` — see `activity.ts`'s header for why that's the
// property that makes running alongside Phase 3's `Bash`-only chop hook on
// the same event safe. This hook expresses no opinion about whether the
// tool call should proceed; it only records that one is about to.
//
// Deliberately does NOT call `loadConfig` (no zod on this path, and no
// config gate — see `activity.ts`'s header: the statusline's own
// `activitySegment` already gates on `statusline.enabled` and staleness on
// the read side, so gating the write side too would just be two places that
// could disagree).

import { pathToFileURL } from "node:url";
import { readHookInput, writeHookOutput, type HookOutput } from "../core/hook-io.js";
import { writeActivityBeacon } from "./activity.js";

export interface ActivityPreToolUseHookInput {
  tool_name?: string;
}

export async function runActivityHook(
  readInput: () => Promise<ActivityPreToolUseHookInput | null>,
  options: { home?: string; now?: number } = {}
): Promise<HookOutput> {
  const input = await readInput();
  const tool = input?.tool_name;
  if (typeof tool === "string" && tool.length > 0) {
    writeActivityBeacon({ tool, timestamp: options.now ?? Date.now() }, { home: options.home });
  }
  // Bare no-op — see module header. This hook never expresses a permission opinion.
  return {};
}

async function main(): Promise<void> {
  const output = await runActivityHook(() => readHookInput<ActivityPreToolUseHookInput>());
  writeHookOutput(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}
