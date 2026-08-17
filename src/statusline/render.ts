// Module 3: statusline context meter — the pure renderer.
//
// HARD CONSTRAINT (plan Module 3): Claude Code debounces statusline updates
// at ~300ms and CANCELS (never queues) an in-flight script on the next
// trigger — a slow script simply never renders. That means `render()` must
// have zero I/O and zero heavy/native dependencies: no `node:fs`, no
// `node:child_process`, no zod/commander/@toon-format. Everything this
// function needs is either already on `input` (the exact Claude Code
// statusline stdin schema, see `StatuslineInput` below) or precomputed and
// handed in via `ctx` (`RenderContext`) — the actual I/O (reading stdin,
// reading the ledger, reading the activity beacon, reading config) happens
// in `io.ts` and the `cli.ts` entry point, never here. This split is what
// makes `render.ts`/`segments.ts` trivially unit-testable without touching
// the filesystem.
//
// `StatuslineInput` intentionally mirrors ONLY the real Claude Code
// statusline stdin schema (confirmed shape, not guessed):
//   model.id, model.display_name, cwd, workspace.current_dir,
//   workspace.project_dir, cost.total_cost_usd,
//   context_window.used_percentage, context_window.remaining_percentage,
//   context_window.context_window_size, context_window.total_input_tokens,
//   exceeds_200k_tokens, transcript_path
// Every field (including whole nested objects) is optional/nullable —
// Claude Code may omit fields, and `context_window.used_percentage` is
// specifically documented to be `null` before the first API call in a
// session and immediately after `/compact`. optiflow-internal precomputed
// data (activity beacon, recent-savings figure, resolved config, "now")
// deliberately does NOT live on this type — see `RenderContext` — so this
// interface stays a faithful, uncluttered model of what Claude Code sends.

import {
  activitySegment,
  costSegment,
  meterSegment,
  modelSegment,
  savingsSegment,
} from "./segments.js";

export interface StatuslineModelInfo {
  id?: string | null;
  display_name?: string | null;
}

export interface StatuslineWorkspaceInfo {
  current_dir?: string | null;
  project_dir?: string | null;
}

export interface StatuslineCostInfo {
  total_cost_usd?: number | null;
}

export interface StatuslineContextWindowInfo {
  used_percentage?: number | null;
  remaining_percentage?: number | null;
  context_window_size?: number | null;
  total_input_tokens?: number | null;
}

export interface StatuslineInput {
  model?: StatuslineModelInfo | null;
  cwd?: string | null;
  workspace?: StatuslineWorkspaceInfo | null;
  cost?: StatuslineCostInfo | null;
  context_window?: StatuslineContextWindowInfo | null;
  exceeds_200k_tokens?: boolean | null;
  transcript_path?: string | null;
}

/** The five renderable segments, in the order `DEFAULT_RENDER_CONFIG` uses. */
export type SegmentName = "meter" | "model" | "cost" | "activity" | "savings";

export const ALL_SEGMENTS: readonly SegmentName[] = [
  "meter",
  "model",
  "cost",
  "activity",
  "savings",
];

/**
 * Contract for `~/.optiflow/activity.json` (documented for real in
 * `docs/modules.md` — Phase 7's handoff module is specced to produce this
 * file; this phase only defines and consumes the contract, it doesn't
 * produce the file). `timestamp` is epoch milliseconds.
 */
export interface ActivityBeacon {
  tool?: string | null;
  timestamp?: number | null;
}

/** A rough, time-boxed "recent savings" figure — see `io.ts`'s header for why this is "recent", not "this session". */
export interface RecentSavings {
  tokensSaved: number;
  recordCount: number;
}

export interface StatuslineRenderConfig {
  enabled: boolean;
  segments: SegmentName[];
  /** Width, in cells, of the `meter` segment's bar. */
  meterWidth: number;
  /** How old (ms) an activity beacon may be before `activity` renders nothing. */
  activityStaleMs: number;
}

/**
 * NOTE: `segments`/`meterWidth`/`activityStaleMs` are NOT part of
 * `OptiflowConfigSchema` (src/config/schema.ts, owned by an earlier phase
 * and out of scope for this one) — that schema only validates
 * `statusline.enabled`/`statusline.debounceMs` today. `io.ts`'s
 * `readStatuslineConfig` reads these three extra keys directly out of the
 * raw config JSON (defensively, without zod) so they're configurable now
 * without touching `src/config/`; see `docs/modules.md` for the follow-up
 * note about eventually folding them into the real schema.
 */
export const DEFAULT_RENDER_CONFIG: StatuslineRenderConfig = {
  enabled: true,
  segments: [...ALL_SEGMENTS],
  meterWidth: 10,
  activityStaleMs: 5_000,
};

/** Precomputed/optiflow-internal data the pure renderer needs but must never fetch itself. */
export interface RenderContext {
  config?: Partial<StatuslineRenderConfig>;
  activity?: ActivityBeacon | null;
  savings?: RecentSavings | null;
  /** Epoch ms "current time", injectable for deterministic tests of the `activity` segment's staleness check. */
  now?: number;
}

function resolveConfig(partial: Partial<StatuslineRenderConfig> | undefined): StatuslineRenderConfig {
  return {
    enabled: partial?.enabled ?? DEFAULT_RENDER_CONFIG.enabled,
    segments: partial?.segments ?? DEFAULT_RENDER_CONFIG.segments,
    meterWidth: partial?.meterWidth ?? DEFAULT_RENDER_CONFIG.meterWidth,
    activityStaleMs: partial?.activityStaleMs ?? DEFAULT_RENDER_CONFIG.activityStaleMs,
  };
}

const SEGMENT_SEPARATOR = " │ ";

/**
 * Pure statusline renderer: `render(input) -> string`, no I/O. Composes
 * whichever segments `config.segments` lists (default: all five, in the
 * plan's documented order), skipping any segment that renders an empty
 * string, and joins the rest with `SEGMENT_SEPARATOR`. Returns `""`
 * outright when `config.enabled` is false.
 */
export function render(input: StatuslineInput = {}, ctx: RenderContext = {}): string {
  const config = resolveConfig(ctx.config);
  if (!config.enabled) return "";

  const now = ctx.now ?? Date.now();
  const parts: string[] = [];

  for (const segment of config.segments) {
    let rendered = "";
    switch (segment) {
      case "meter":
        rendered = meterSegment(
          input.context_window?.used_percentage ?? null,
          Boolean(input.exceeds_200k_tokens),
          config.meterWidth
        );
        break;
      case "model":
        rendered = modelSegment(input.model ?? null);
        break;
      case "cost":
        rendered = costSegment(input.cost?.total_cost_usd ?? null);
        break;
      case "activity":
        rendered = activitySegment(ctx.activity ?? null, now, config.activityStaleMs);
        break;
      case "savings":
        rendered = savingsSegment(ctx.savings ?? null);
        break;
      default:
        rendered = "";
    }
    if (rendered) parts.push(rendered);
  }

  return parts.join(SEGMENT_SEPARATOR);
}
