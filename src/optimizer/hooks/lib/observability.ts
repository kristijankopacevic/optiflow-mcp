// Lifecycle diagnostics for the enforcement hooks.
//
// CORE-VS-PERIPHERAL SPLIT (see this phase's report). Vendor's
// `observability.mjs`
// (`vendor/token-optimizer-mcp/plugin/hooks/lib/observability.mjs`,
// MIT-licensed — see THIRD_PARTY_LICENSES.md) bundles two genuinely
// different things behind one `beginHookInvocation` call:
//
//   1. A DEADLINE that fires `process.exit(0)` after
//      `TOKEN_OPTIMIZER_HOOK_DEADLINE_MS` (default 4200ms) to "beat the
//      host's five-second timeout and fail open deterministically". This
//      DOES change what Claude Code sees (a bare allow instead of whatever
//      the decision would have been) — it is core. Ported, but at the
//      call-site level: `pretooluse.ts`/`precompact.ts`'s own `main()`
//      races the real decision against this same deadline via
//      `Promise.race`, matching this repo's existing pure-core/thin-wrapper
//      hook shape (`src/chop/pretooluse.ts`) instead of vendor's
//      exit-from-inside-a-timer approach.
//   2. Privacy-safe JSONL diagnostics (log rotation/retention, hashed
//      session/tool dimensions, `hookHealthSummary`/`readHookEvents` for a
//      dashboard) — write-only, consumed by nothing this hook returns to
//      Claude Code. Peripheral by the decision-changing-output test, and
//      overlaps `src/optimizer/analytics/**`'s already-merged, do-not-touch
//      ownership. Not ported; `beginHookInvocation`/`noteHookOutput` below
//      are no-ops that preserve vendor's call-site shape so `pretooluse.ts`
//      needs no special-casing.

export interface HookInvocation {
  invocationId: string;
  bind(raw?: Record<string, unknown>, payload?: unknown, payloadBytes?: number | null): void;
  noteInput(status: string, payloadBytes?: number | null): void;
  skip(reason: string): void;
  noteOutput(output: unknown, outputBytes?: number | null): void;
  fail(error: unknown, reason?: string): void;
  block(reason?: string): void;
  succeed(reason?: string): void;
}

/** No-op diagnostics handle — see module header. The real deadline lives in the hook entry's `main()`. */
export function beginHookInvocation(
  _client: string,
  _event: string,
  _options: { deadlineMs?: number } = {}
): HookInvocation {
  return {
    invocationId: "",
    bind() {},
    noteInput() {},
    skip() {},
    noteOutput() {},
    fail() {},
    block() {},
    succeed() {},
  };
}

/** No-op — see module header. */
export function noteHookOutput(_output: unknown, _outputBytes: number | null = null): void {}

/** The deadline this fork actually enforces, at the hook-entry `main()` level. */
export function hookDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.TOKEN_OPTIMIZER_HOOK_DEADLINE_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4200;
}
