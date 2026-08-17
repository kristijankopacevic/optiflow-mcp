// Claude Code hook stdin/stdout plumbing.
//
// Field names/casing below are primary-sourced from the vendored
// token-optimizer-mcp submodule's own real hook code (not guessed, and not
// fetched from docs — this environment has no web-fetch tool available), so
// they reflect what a working Claude Code hook actually emits today:
//   - `hookSpecificOutput.hookEventName`               vendor/token-optimizer-mcp/plugin/hooks/session-start.mjs:157
//   - `hookSpecificOutput.permissionDecision` (+Reason) vendor/token-optimizer-mcp/plugin/hooks/lib/policy.mjs:679-682
//   - `hookSpecificOutput.additionalContext`            vendor/token-optimizer-mcp/plugin/hooks/lib/policy.mjs:660
//   - `hookSpecificOutput.updatedMCPToolOutput`         vendor/token-optimizer-mcp/hooks/handlers/token-optimizer-orchestrator.ps1:2343-2351
// `updatedInput` is NOT emitted anywhere in the vendored submodule (the plan
// calls this out explicitly: token-optimizer's PreToolUse router never emits
// it, which is exactly why optiflow's chop module claims that ground). Its
// placement here — inside `hookSpecificOutput`, alongside `permissionDecision`
// — follows the same nesting pattern as the three confirmed fields above and
// documented Claude Code hook behavior, but is UNVERIFIED against a live
// working example in this codebase. Flagging this so nobody downstream reads
// it as primary-sourced fact.

/** Claude Code hook event names optiflow currently cares about. */
export type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "PreCompact"
  | "Stop"
  | "SubagentStop";

export interface HookSpecificOutput {
  hookEventName: HookEventName;
  permissionDecision?: "allow" | "deny" | "ask";
  permissionDecisionReason?: string;
  /** UNVERIFIED placement — see module header comment. */
  updatedInput?: Record<string, unknown>;
  updatedMCPToolOutput?: { content: unknown[] };
  additionalContext?: string;
}

export interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
  hookSpecificOutput?: HookSpecificOutput;
}

const DEFAULT_OUTPUT_CAP_CHARS = 10_000;

/**
 * Reads and parses the entire stdin payload Claude Code sends a hook.
 * Never throws: malformed/empty input resolves to `null` so a hook can fail
 * open (allow) instead of crashing.
 */
export async function readHookInput<T = Record<string, unknown>>(
  stdin: NodeJS.ReadableStream = process.stdin
): Promise<T | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (raw.length === 0) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function findLongestStringPath(
  value: unknown,
  currentPath: Array<string | number> = [],
  best: { path: Array<string | number> | null; len: number } = {
    path: null,
    len: -1,
  }
): Array<string | number> | null {
  if (typeof value === "string") {
    if (value.length > best.len) {
      best.len = value.length;
      best.path = currentPath.slice();
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findLongestStringPath(item, [...currentPath, index], best)
    );
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      findLongestStringPath(
        (value as Record<string, unknown>)[key],
        [...currentPath, key],
        best
      );
    }
  }
  return best.path;
}

function getAtPath(obj: unknown, pathParts: Array<string | number>): unknown {
  return pathParts.reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string | number, unknown>)[key];
  }, obj);
}

function setAtPath(
  obj: unknown,
  pathParts: Array<string | number>,
  value: unknown
): void {
  if (pathParts.length === 0) return;
  const parentPath = pathParts.slice(0, -1);
  const lastKey = pathParts[pathParts.length - 1];
  const parent = parentPath.length === 0 ? obj : getAtPath(obj, parentPath);
  if (parent && typeof parent === "object") {
    (parent as Record<string | number, unknown>)[lastKey] = value;
  }
}

/**
 * Serializes `value` to JSON, enforcing the 10,000-character output cap.
 *
 * If the plain serialization already fits, it's returned unchanged. If not,
 * this shrinks the single longest string field found anywhere in the value
 * (never slices the serialized JSON itself, which would produce invalid
 * JSON and break the hook) and appends a
 * `...[truncated, N chars omitted]` marker to it, then re-serializes.
 *
 * If no string field exists to shrink (rare for real hook payloads, which
 * always carry a message/context/reason string when they're large enough to
 * need truncation), this falls back to returning the untruncated JSON — a
 * documented limitation rather than emitting invalid JSON.
 */
export function toCappedJson(
  value: unknown,
  capChars: number = DEFAULT_OUTPUT_CAP_CHARS
): string {
  const full = JSON.stringify(value);
  if (full.length <= capChars) return full;

  // Re-parse our own stringified form: a cheap, JSON-safe deep clone that
  // never fails on the exotic values structuredClone chokes on (functions,
  // etc. can't appear here anyway since JSON.stringify already dropped them).
  const clone = JSON.parse(full);
  const targetPath = findLongestStringPath(clone);
  if (!targetPath) {
    return full;
  }

  const originalStr = String(getAtPath(clone, targetPath));
  let str = originalStr;
  let serialized = full;

  // The marker must be included in every length check below — returning
  // early from this loop once the *unmarked* shrunk string fits under the
  // cap would ship a truncated value with no truncation marker at all.
  for (let attempt = 0; attempt < 15; attempt++) {
    const omitted = originalStr.length - str.length;
    const marker = `...[truncated, ${omitted} chars omitted]`;
    setAtPath(clone, targetPath, omitted > 0 ? str + marker : str);
    serialized = JSON.stringify(clone);
    if (serialized.length <= capChars) break;

    const over = serialized.length - capChars;
    // Trim generously (over-shrink a bit) so this converges in a handful of
    // iterations even when JSON escaping inflates the string's serialized
    // length beyond its raw .length.
    const trimBy = Math.ceil(over * 1.1) + marker.length + 10;
    const nextLen = Math.max(0, str.length - trimBy);
    if (nextLen === str.length) {
      str = "";
      break;
    }
    str = str.slice(0, nextLen);
    if (str.length === 0) break;
  }

  if (serialized.length > capChars) {
    // Pathological case (e.g. the marker itself doesn't fit): drop to just
    // the marker rather than exceeding the cap.
    const marker = `...[truncated, ${originalStr.length} chars omitted]`;
    setAtPath(clone, targetPath, marker);
    serialized = JSON.stringify(clone);
  }

  return serialized;
}

/** Writes a hook's JSON output to stdout, applying the output cap. */
export function writeHookOutput(
  output: HookOutput,
  capChars: number = DEFAULT_OUTPUT_CAP_CHARS,
  stdout: NodeJS.WritableStream = process.stdout
): void {
  stdout.write(toCappedJson(output, capChars));
}

// ---------------------------------------------------------------------------
// Small builders for the common hook response shapes.
// ---------------------------------------------------------------------------

/** Allow the tool call to proceed, optionally with a reason for the log. */
export function allow(
  hookEventName: HookEventName,
  reason?: string
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  };
}

/** Deny the tool call. `reason` is shown to the model/user. */
export function deny(hookEventName: HookEventName, reason: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** Allow the tool call, and inject `context` as additional context. */
export function allowWithContext(
  hookEventName: HookEventName,
  context: string
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      additionalContext: context,
    },
  };
}

/**
 * Rewrite a tool call's input before it runs (`PreToolUse` only).
 * UNVERIFIED against a real working example — see module header comment.
 */
export function updateInput(
  hookEventName: HookEventName,
  input: Record<string, unknown>
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      updatedInput: input,
    },
  };
}

/**
 * Substitute an MCP tool's result (`PostToolUse` on an `mcp__*` matcher
 * only — this is the only output-substitution contract Claude Code supports
 * for built-in vs. MCP tools; see
 * vendor/token-optimizer-mcp/hooks/handlers/token-optimizer-orchestrator.ps1).
 * `output.content` must match the MCP tool's own output schema
 * (a `CallToolResult`-shaped `{ content: [...] }`).
 */
export function updateMCPOutput(
  hookEventName: HookEventName,
  output: { content: unknown[] }
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      updatedMCPToolOutput: output,
    },
  };
}
