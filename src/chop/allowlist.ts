// Decides whether an already-safety-checked command is eligible for
// chop's PreToolUse rewrite: is its binary on the allowlist (or a
// hardcoded test runner), and does it NOT match an `excludeCommands`
// entry (which takes precedence over an otherwise-eligible binary — this
// is how Module 1 stays out of token-optimizer's `smart_build`/`smart_test`
// ground; see plan Authority Map).
//
// Config is read from `src/config/` (Phase 2's loader/schema), never
// hardcoded here separately, per the task's explicit instruction.

import { splitWords } from "./shell-safety.js";

/**
 * Test runners eligible for chopping regardless of `chop.allowlist`
 * contents (the plan calls these out by name, distinct from the
 * user-configurable allowlist which defaults to
 * git/docker/kubectl/npm/terraform).
 */
export const BUILTIN_TEST_RUNNERS = ["jest", "vitest", "pytest"] as const;

export interface AllowlistConfig {
  allowlist: string[];
  excludeCommands: string[];
}

export interface AllowlistDecision {
  eligible: boolean;
  /** The first token of the command, when one could be identified. */
  binary?: string;
  reason: string;
}

/**
 * Normalizes whitespace for `excludeCommands` comparison so
 * `"npm  test"` and `"npm test"` are treated the same — this is a exact
 * (not prefix/substring) match against the whole command string, just
 * forgiving of incidental whitespace differences.
 */
function normalizeForCompare(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** True if `command` exactly matches (whitespace-normalized) any entry in `excludeCommands`. */
export function isExcluded(command: string, excludeCommands: string[]): boolean {
  const normalized = normalizeForCompare(command);
  return excludeCommands.some((entry) => normalizeForCompare(entry) === normalized);
}

/**
 * Decides eligibility for the chop rewrite. Callers must have already run
 * `isSingleSimpleCommand` themselves (this function does not re-check for
 * shell metacharacters) — see `pretooluse.ts` for the full decision order.
 */
export function getAllowlistDecision(
  command: string,
  config: AllowlistConfig
): AllowlistDecision {
  if (isExcluded(command, config.excludeCommands)) {
    return {
      eligible: false,
      reason:
        "matches chop.excludeCommands — takes precedence over the allowlist (owned by another tool, e.g. token-optimizer's smart_build/smart_test)",
    };
  }

  const words = splitWords(command);
  const binary = words[0];
  if (!binary) {
    return { eligible: false, reason: "no binary token found in command" };
  }

  if (config.allowlist.includes(binary)) {
    return { eligible: true, binary, reason: `binary '${binary}' is on chop.allowlist` };
  }

  if ((BUILTIN_TEST_RUNNERS as readonly string[]).includes(binary)) {
    return { eligible: true, binary, reason: `binary '${binary}' is a built-in test runner` };
  }

  if (binary === "go" && words[1] === "test") {
    return { eligible: true, binary, reason: "'go test' is a built-in test runner form" };
  }

  return {
    eligible: false,
    binary,
    reason: `binary '${binary}' is not on chop.allowlist and is not a recognized test runner`,
  };
}
