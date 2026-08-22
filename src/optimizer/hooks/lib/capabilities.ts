// Which optimizer MCP tools the router may name as a replacement.
//
// WHY THIS IS EVIDENCE-BASED AGAIN. An earlier version of this file always
// returned `proven: true` with every tool name, on the reasoning that "every
// name below is a tool this same process's own `src/optimizer/server.ts`
// always registers, so there is no cross-process registration gap to protect
// against." That reasoning was wrong, and it produced the worst bug this
// plugin has had: it did not merely fail to save tokens, it BLOCKED WORK.
//
// The hook and the MCP server are different processes. `hooks/
// pretooluse-optimizer.mjs` and `dist/optimizer/server.js` ship in one
// package but run separately, and the hook cannot see whether the server
// actually started, whether the user disabled it, or whether Claude Code
// loaded it at all.
//
// Worse, and the case actually observed in the wild: a SUBAGENT with a
// restricted tool list (e.g. `Explore` with `Read, Grep, Glob, Bash`) has NO
// MCP tools whatsoever. Denying its `Grep` and telling it to "call
// smart_grep instead" points it at a tool it cannot reach, from which there
// is no recovery — the agent burns a turn, retries, and is refused again.
//
// So: a tool name is nameable in a refusal only once something has actually
// OBSERVED that tool being called in this session (recorded by the
// `PostToolUse` hook — see `recordOptimizerToolObservation`), or the
// operator has declared the set explicitly via
// `TOKEN_OPTIMIZER_MCP_CAPABILITIES`. This is the same shape as the vendored
// upstream's own `capabilities.mjs`, whose premise this file previously
// dismissed.
//
// THE BOOTSTRAP, which is the part worth understanding: until a tool is
// observed, nothing is proven, so the router must not DENY. It advises
// instead (see `pretooluse.ts`'s effective-mode logic) — the note still
// names `smart_read`, so a client that CAN reach it will, and that call is
// what proves the tool and switches enforcement on. A client that cannot
// reach it is never blocked. The system converges to enforcement exactly
// where enforcement is possible, and stays out of the way everywhere else.

import { loadState, saveState } from "./policy.js";

/** MCP tools whose presence changes hook behaviour. */
export const HOOK_MCP_TOOLS = [
  "smart_read",
  "smart_write",
  "smart_edit",
  "smart_glob",
  "smart_grep",
  "optimize_session",
  "get_optimization_report",
  "wiki_write",
] as const;

const HOOK_MCP_TOOL_SET = new Set<string>(HOOK_MCP_TOOLS);

export interface ToolEvidence {
  /**
   * Whether the router may DENY on the strength of these names. False means
   * "we have never seen one of these tools actually work here" — advise, do
   * not block.
   */
  proven: boolean;
  names: Set<string>;
}

/**
 * Extracts an optimizer tool name from a full MCP tool identifier.
 *
 * Claude Code namespaces MCP tools as `mcp__<server>__<tool>`, and a plugin's
 * server picks up a further prefix
 * (`mcp__plugin_optiflow_optiflow-optimizer__smart_read`). Matching on the
 * segment after the final `__` is stable across both, and across whatever
 * the user named the server in their own config.
 *
 * Returns `null` for anything that is not one of `HOOK_MCP_TOOLS`, including
 * a bare `smart_read` with no `mcp__` prefix — evidence has to come from a
 * real MCP call, not from a string that happens to look like one.
 */
export function optimizerToolFromMcpName(toolName: unknown): string | null {
  if (typeof toolName !== "string" || !toolName.startsWith("mcp__")) return null;
  const last = toolName.slice(toolName.lastIndexOf("__") + 2);
  return HOOK_MCP_TOOL_SET.has(last) ? last : null;
}

function parseOverride(override: string): Set<string> {
  const names = new Set<string>();
  let parsed: unknown = null;
  if (/^\s*\[/.test(override)) {
    try {
      parsed = JSON.parse(override);
    } catch {
      parsed = null;
    }
  }
  const items = Array.isArray(parsed) ? parsed : override.split(/[\s,]+/);
  for (const item of items) {
    const name = String(item).trim();
    if (HOOK_MCP_TOOL_SET.has(name)) names.add(name);
  }
  return names;
}

/** Session state fields this module reads. Narrow on purpose. */
export interface ToolEvidenceState {
  optimizerTools?: string[];
  optimizerToolsObservedAt?: number;
}

/**
 * What the router is allowed to name, and whether it may deny.
 *
 * `TOKEN_OPTIMIZER_MCP_CAPABILITIES` (CSV or JSON array) is an explicit
 * operator declaration and is therefore trusted as proof — including the
 * empty string, which is a deliberate "this client has none of them" and
 * correctly disables every replacement suggestion.
 */
export function optimizerToolsForHook(
  _raw: unknown = {},
  state: ToolEvidenceState | null = null,
  env: NodeJS.ProcessEnv = process.env
): ToolEvidence {
  const override = env.TOKEN_OPTIMIZER_MCP_CAPABILITIES;
  if (override !== undefined) {
    return { proven: true, names: parseOverride(override) };
  }

  const observed = Array.isArray(state?.optimizerTools)
    ? state.optimizerTools.filter((name) => HOOK_MCP_TOOL_SET.has(name))
    : [];

  if (observed.length > 0) {
    return { proven: true, names: new Set(observed) };
  }

  // Unproven. The names are still returned so the router can produce a
  // verdict whose text names the right tool -- what changes is that
  // `pretooluse.ts` downgrades that verdict to advisory. Returning an EMPTY
  // set here would suppress the suggestion entirely and the tool would never
  // get discovered, so the bootstrap would never complete.
  return { proven: false, names: new Set(HOOK_MCP_TOOLS) };
}

/**
 * Records that `toolName` was really called, so the router may start denying
 * in favour of it.
 *
 * Called from the `PostToolUse` `mcp__.*` hook, which is the only place in
 * this plugin that sees an MCP tool call actually happen. Never throws: this
 * is opportunistic evidence-gathering, and failing to record it costs only a
 * missed enforcement opportunity.
 */
export function recordOptimizerToolObservation(
  toolName: unknown,
  sessionId: unknown,
  agent?: string | null,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  try {
    const name = optimizerToolFromMcpName(toolName);
    if (!name) return false;

    const state = loadState(sessionId, agent, env);
    if (state.optimizerTools.includes(name)) return false;

    state.optimizerTools = [...state.optimizerTools, name];
    state.optimizerToolsObservedAt = Date.now();
    return saveState(sessionId, state, agent, env);
  } catch {
    return false;
  }
}

/**
 * Kept as a no-op for call sites ported verbatim from the vendored router.
 * Observation now happens in `recordOptimizerToolObservation`, driven by the
 * `PostToolUse` hook, because that is the only point at which a tool call is
 * known to have SUCCEEDED — inferring it on the `PreToolUse` side would
 * record tools that were merely attempted.
 */
export function rememberOptimizerTools<T>(state: T, _evidence: ToolEvidence, _observedAt: number = Date.now()): T {
  return state;
}
