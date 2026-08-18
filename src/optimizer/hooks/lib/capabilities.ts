// Which optimizer MCP tools the router may name as a replacement.
//
// DELIBERATE SIMPLIFICATION vs. vendor (documented per this phase's brief,
// not a silent shortcut). Vendor's `capabilities.mjs`
// (`vendor/token-optimizer-mcp/plugin/hooks/lib/capabilities.mjs`,
// MIT-licensed — see THIRD_PARTY_LICENSES.md) exists because token-optimizer
// ships as a SEPARATE MCP server process from a SEPARATE npm package: the
// hook and the server can disagree about which tools are actually
// registered (the server failed to start, a bounded tool profile omitted
// some tools, etc.), so the hook has to ask the runtime for positive
// evidence before naming a tool in a refusal.
//
// That premise does not hold here. Per the plan's locked decision ("The 120
// `smart_*` MCP tools register directly on optiflow's own MCP server
// object instead of a separate token-optimizer-mcp process — one MCP server
// exposing everything"), every name in `HOOK_MCP_TOOLS` below is a tool
// this same process's own `src/optimizer/server.ts` always registers. There
// is no cross-process registration gap to protect against, so this module
// always returns `proven: true` with every known tool name rather than
// porting vendor's full cross-client evidence-sniffing machinery
// (`optimizerToolEvidence`'s payload/env inventory scraping, built for
// clients like Roo/Zed/Amp that only expose MCP tools, never hooks).
//
// The env var escape hatch is kept: `TOKEN_OPTIMIZER_MCP_CAPABILITIES` can
// still restrict the set explicitly (e.g. a future bounded tool profile),
// matching vendor's own documented override.

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
  proven: boolean;
  names: Set<string>;
}

/**
 * All optimizer tools are always registered in this merged process — see
 * module header. `TOKEN_OPTIMIZER_MCP_CAPABILITIES`, if set, restricts the
 * set to an explicit CSV/JSON list of names (vendor's own override syntax),
 * for a future bounded tool profile.
 */
export function optimizerToolsForHook(
  _raw: unknown = {},
  _state: unknown = {},
  env: NodeJS.ProcessEnv = process.env
): ToolEvidence {
  const override = env.TOKEN_OPTIMIZER_MCP_CAPABILITIES;
  if (override !== undefined) {
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
    return { proven: true, names };
  }
  return { proven: true, names: new Set(HOOK_MCP_TOOLS) };
}

/**
 * No-op in this merged process (session state's `optimizerTools`/
 * `optimizerToolsObservedAt` fields exist only for vendor's cross-process
 * rehydration path, which this simplification makes unnecessary) — kept as
 * a function so callers ported verbatim from the router don't need an
 * `if` around it.
 */
export function rememberOptimizerTools<T>(state: T, _evidence: ToolEvidence, _observedAt: number = Date.now()): T {
  return state;
}
