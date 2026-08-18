// The mid-session runway forecast panel ("you have N turns before
// compaction") and its PreCompact calibration close.
//
// CHECKPOINT-1 STUB. Vendor's `surface.mjs`
// (`vendor/token-optimizer-mcp/plugin/hooks/lib/surface.mjs`, MIT-licensed
// — see THIRD_PARTY_LICENSES.md) pulls in `forecast.mjs` (runway
// computation from transcript token usage) and `calibration.mjs` (scoring
// past forecasts against what actually happened) — a real, self-contained
// subsystem, but not yet ported. Both call sites in vendor's own two hooks
// treat it as fail-open by contract already ("NOTHING HERE IS ALLOWED TO
// BREAK A TOOL CALL. Every entry point returns null on failure rather than
// throwing: a forecast is a courtesy") — so stubbing to "never has anything
// to say" is a strict subset of vendor's own documented behavior, not a
// new failure mode. `pretooluse.ts`/`precompact.ts` call these exact
// signatures; wiring the real forecast/calibration logic in behind them
// (a follow-up phase) requires no call-site change.

export interface SurfaceState {
  checkedAt: number;
  shown?: number;
}

export interface SurfaceResult {
  text: string | null;
  state: SurfaceState | null;
}

/**
 * Should the forecast interrupt right now, and with what? Always "no" in
 * this checkpoint — see module header.
 */
export function maybeSurface(
  _dir: string,
  options: { state?: { forecast?: SurfaceState | null } } = {}
): SurfaceResult {
  return { text: null, state: options.state?.forecast ?? null };
}

/**
 * Closes the calibration loop at PreCompact. Always a no-op in this
 * checkpoint (vendor's own contract: "Silent by design: nothing is shown
 * to anybody" — this call's return value is already discarded by both of
 * vendor's own callers).
 */
export function closeForecast(
  _dir: string,
  _options: { transcriptPath?: string | null; sessionId?: string } = {}
): boolean {
  return false;
}
