// The `PreToolUse` hook entry for Module 1 (matcher `Bash` ONLY — this hook
// must never even be consulted for `Read`/`Grep`/`Glob`/`Edit`/`Write`; that
// exclusion is enforced both here, defensively, and via `hooks.json`'s
// matcher). Decides whether to rewrite `tool_input.command` to
// `optiflow-chop <command>`.
//
// PERMISSION-MODEL CORRECTNESS NOTE (deviates from a literal reading of the
// task brief, on purpose — see below): the "not eligible to rewrite" path
// returns a BARE `{}`, not `allow()`. `hook-io.ts`'s `allow()` sets
// `permissionDecision: "allow"`, which actively approves the tool call
// without Claude Code's own permission prompt ever running. This hook fires
// on every single `Bash` call; if the pass-through path called `allow()`,
// this module would silently disable Bash permission prompting for every
// command that isn't eligible for rewriting — the exact regression plan
// Risk R4 warns about, just inverted. This is confirmed against the
// vendored token-optimizer-mcp's own real hook code, not guessed:
// `vendor/token-optimizer-mcp/plugin/hooks/lib/policy.mjs` (around its
// `advise()`/no-op path) explicitly documents "Nothing is emitted when
// there is nothing to say, so the common path stays a bare `{}`" — i.e. the
// vendored tool, which this plan's own research established never emits
// `updatedInput`, ALSO never emits `permissionDecision: "allow"` for its
// pass-through path. `deny()` is for actively vetoing a call; there is no
// vendored evidence `allow()` is meant for "I have no opinion".

import { pathToFileURL } from "node:url";
import { readHookInput, updateInput, writeHookOutput, type HookOutput } from "../core/hook-io.js";
import { loadConfig } from "../config/load.js";
import { getAllowlistDecision } from "./allowlist.js";
import { isSingleSimpleCommand } from "./shell-safety.js";

export interface PreToolUseHookInput {
  tool_name?: string;
  tool_input?: {
    command?: string;
    [key: string]: unknown;
  };
}

export interface PreToolUseDecision {
  rewrite: boolean;
  reason: string;
}

/**
 * The pure decision function, exported for direct unit testing without
 * going through stdin/stdout. `cwd`/`home` are forwarded to `loadConfig`
 * for test isolation.
 */
export function decidePreToolUse(
  input: PreToolUseHookInput,
  loadOptions: { cwd?: string; home?: string } = {}
): PreToolUseDecision {
  // Defensive early exit: this hook's logic must never even be consulted
  // for a non-Bash tool call, regardless of what hooks.json's matcher does.
  if (input.tool_name !== "Bash") {
    return { rewrite: false, reason: "not a Bash tool call" };
  }

  const command = input.tool_input?.command;
  if (typeof command !== "string") {
    return { rewrite: false, reason: "tool_input.command missing or not a string" };
  }

  const { config } = loadConfig(loadOptions);
  if (!config.chop.enabled) {
    return { rewrite: false, reason: "chop.enabled is false" };
  }

  const safety = isSingleSimpleCommand(command);
  if (!safety.safe) {
    return { rewrite: false, reason: safety.reason ?? "not a single simple command" };
  }

  const allowlistDecision = getAllowlistDecision(command, {
    allowlist: config.chop.allowlist,
    excludeCommands: config.chop.excludeCommands,
  });
  if (!allowlistDecision.eligible) {
    return { rewrite: false, reason: allowlistDecision.reason };
  }

  return { rewrite: true, reason: allowlistDecision.reason };
}

/** Builds the actual hook output for a decision, given the original input. */
export function buildHookOutput(input: PreToolUseHookInput, decision: PreToolUseDecision): HookOutput {
  if (!decision.rewrite) {
    // See module header: a bare no-op, never an explicit `allow()`.
    return {};
  }
  const command = input.tool_input?.command as string;
  return updateInput("PreToolUse", {
    ...input.tool_input,
    command: `optiflow-chop ${command}`,
  });
}

export async function runPreToolUse(
  readInput: () => Promise<PreToolUseHookInput | null>,
  loadOptions: { cwd?: string; home?: string } = {}
): Promise<HookOutput> {
  const input = await readInput();
  if (!input) return {};
  const decision = decidePreToolUse(input, loadOptions);
  return buildHookOutput(input, decision);
}

// ---------------------------------------------------------------------------
// Process entry point (guarded).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const output = await runPreToolUse(() => readHookInput<PreToolUseHookInput>());
  writeHookOutput(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}
