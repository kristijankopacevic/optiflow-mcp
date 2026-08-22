// Claude Code hook stdin/stdout plumbing.
//
// Every field name and shape below is VERIFIED against a live Claude Code
// 2.1.235 session (real `claude -p` run, hook stdin captured, hook output
// observed in the delivered tool result) — not inferred from docs and not
// carried over from the vendored upstream, which encoded one of them wrongly.
//
//   - `hookSpecificOutput.hookEventName`                confirmed
//   - `hookSpecificOutput.permissionDecision` (+Reason)  confirmed
//   - `hookSpecificOutput.additionalContext`             confirmed
//   - `hookSpecificOutput.updatedInput`                  confirmed present in the
//       shipped CLI binary and honored on PreToolUse. (This was previously
//       flagged UNVERIFIED here because the vendored upstream never emitted
//       it; that caveat is now retired.)
//   - `hookSpecificOutput.updatedMCPToolOutput`          confirmed — but the
//       payload is a BARE ARRAY of content blocks, NOT `{ content: [...] }`.
//       The vendored PowerShell orchestrator
//       (token-optimizer-orchestrator.ps1:2343-2351) used the object form,
//       which we copied; Claude Code accepts it, logs "replaced tool output",
//       and then crashes the tool result with `e.reduce is not a function`.
//       The CLI's own handler is
//         `if (p.updatedMCPToolOutput !== void 0 && isMcpTool(t))
//            yield { updatedToolOutput: p.updatedMCPToolOutput }`
//       and the value is reduced over as an array downstream. Emitting the
//       bare array substitutes the payload correctly.
//
// Note the asymmetry with hook INPUT: `tool_response` arrives as a bare array
// too (see src/chop/posttooluse-mcp.ts's `normalizeToolResponse`).

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
  updatedInput?: Record<string, unknown>;
  updatedMCPToolOutput?: unknown[];
  additionalContext?: string;
}

export interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
  hookSpecificOutput?: HookSpecificOutput;
}

/**
 * Exported so producers of large payloads (the deny-and-substitute path in
 * `src/optimizer/hooks/pretooluse.ts`) can fit their content to the envelope
 * BEFORE serialization, instead of letting `toCappedJson` amputate it here.
 * `toCappedJson`'s truncation is a structural last resort: it slices the
 * longest string mid-anything, which for a code outline means cutting a
 * signature in half while the preface still promises completeness.
 */
export const DEFAULT_OUTPUT_CAP_CHARS = 10_000;

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
 * Inject `context` with NO permission decision attached.
 *
 * This is the correct builder for events that have no permission decision
 * to make at all — `SessionStart` above all, which is the one documented
 * context-re-injection idiom. `allowWithContext` would additionally emit
 * `permissionDecision: "allow"`, which on such an event is meaningless
 * noise at best; see `src/chop/posttooluse-mcp.ts`'s module header for the
 * same reasoning applied to `PostToolUse`.
 */
export function withAdditionalContext(
  hookEventName: HookEventName,
  context: string
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext: context,
    },
  };
}

/**
 * Deny the tool call, but hand the model the compressed content it would
 * otherwise need a second round trip (e.g. an MCP `smart_read` call) to
 * get. `reason` is shown as the denial explanation, exactly like `deny()`;
 * `context` rides in `additionalContext` alongside the denial — the same
 * field `allowWithContext()` uses, and the exact `permissionDecision` +
 * `permissionDecisionReason` + `additionalContext` combination this
 * module's header cites as verified and used in production by the
 * highest-starred competitor. One round trip, no dependence on the model
 * choosing to call the replacement tool.
 */
export function denyWithSubstitute(
  hookEventName: HookEventName,
  reason: string,
  context: string
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      additionalContext: context,
    },
  };
}

/**
 * Rewrite a tool call's input before it runs (`PreToolUse` only).
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
 * Substitute an MCP tool's result (`PostToolUse` on an `mcp__*` matcher only).
 *
 * `content` is a BARE ARRAY of content blocks — NOT a `CallToolResult`-shaped
 * `{ content: [...] }` wrapper, which is what the vendored PowerShell
 * orchestrator emitted and what this function used to emit. Claude Code
 * accepts the object form and logs "replaced tool output", then reduces over
 * the value as an array and crashes the tool result with
 * `e.reduce is not a function`. Verified live against Claude Code 2.1.235:
 * the bare array substitutes the payload correctly. See the module header.
 */
export function updateMCPOutput(
  hookEventName: HookEventName,
  content: unknown[]
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      updatedMCPToolOutput: content,
    },
  };
}
