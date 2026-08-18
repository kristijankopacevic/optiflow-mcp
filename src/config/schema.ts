// Zod schema validating the optiflow.config.json shape.
//
// Deliberately NOT `.strict()` anywhere: an unknown key (e.g. from a future
// phase's config section, or a typo) must not collapse the whole config to
// defaults. Zod's default object behavior already strips unknown keys, which
// combined with load.ts's stderr warning on real validation failures is the
// "fail open, never crash a hook over malformed config" shape this needs.

import { z } from "zod";
import { DEFAULT_CONFIG } from "./defaults.js";

export const EngineTokenOptimizerSchema = z.object({
  mode: z.enum(["npx", "disabled"]).default(DEFAULT_CONFIG.engines.tokenOptimizer.mode),
  package: z.string().default(DEFAULT_CONFIG.engines.tokenOptimizer.package),
  version: z.string().default(DEFAULT_CONFIG.engines.tokenOptimizer.version),
});

export const EngineHeadroomSchema = z.object({
  mode: z.enum(["path", "disabled"]).default(DEFAULT_CONFIG.engines.headroom.mode),
  binary: z.string().default(DEFAULT_CONFIG.engines.headroom.binary),
  enabled: z.boolean().default(DEFAULT_CONFIG.engines.headroom.enabled),
});

export const EnginesSchema = z.object({
  tokenOptimizer: EngineTokenOptimizerSchema.default(DEFAULT_CONFIG.engines.tokenOptimizer),
  headroom: EngineHeadroomSchema.default(DEFAULT_CONFIG.engines.headroom),
});

export const ChopSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.chop.enabled),
  allowlist: z.array(z.string()).default(DEFAULT_CONFIG.chop.allowlist),
  excludeCommands: z.array(z.string()).default(DEFAULT_CONFIG.chop.excludeCommands),
  minOutputBytes: z.number().int().nonnegative().default(DEFAULT_CONFIG.chop.minOutputBytes),
});

export const ToonSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.toon.enabled),
  minSavingsPercent: z.number().min(0).max(100).default(DEFAULT_CONFIG.toon.minSavingsPercent),
  minRows: z.number().int().nonnegative().default(DEFAULT_CONFIG.toon.minRows),
});

export const StatuslineSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.statusline.enabled),
  debounceMs: z.number().int().nonnegative().default(DEFAULT_CONFIG.statusline.debounceMs),
});

export const HandoffSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.handoff.enabled),
  checkpointDir: z.string().default(DEFAULT_CONFIG.handoff.checkpointDir),
  // Phase 7 addition (not present in Phase 2), same additive-config
  // precedent as `chop.minOutputBytes`/`toon.minRows`. Deliberately
  // `.nonnegative()`, NOT `.positive()`: `load.ts` falls back to
  // DEFAULT_CONFIG for the ENTIRE config on any validation failure, so an
  // over-strict lower bound would turn one bad-but-meaningful `keep: 0`
  // value into a total config reset. `0` is a valid, meaningful value here
  // (see `src/handoff/checkpoint.ts`'s `pruneCheckpoints` — it means
  // "unlimited, never prune"), not an error case.
  keep: z.number().int().nonnegative().default(DEFAULT_CONFIG.handoff.keep),
});

export const ReportSchema = z.object({
  includeOptimizer: z.boolean().default(DEFAULT_CONFIG.report.includeOptimizer),
});

export const TelemetrySchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.telemetry.enabled),
});

// Phase 4 addition (v2 plan, "Kompress ONNX port"), same additive-config
// precedent as every other section here. `enabled`/`allowDownload` both
// default to `false` — see `src/config/defaults.ts`'s doc comment on
// `kompress` for why (opt-in, never-implicit-network heavy feature).
export const KompressSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.kompress.enabled),
  allowDownload: z.boolean().default(DEFAULT_CONFIG.kompress.allowDownload),
  variant: z.enum(["int8", "fp32"]).default(DEFAULT_CONFIG.kompress.variant),
});

export const OptiflowConfigSchema = z.object({
  engines: EnginesSchema.default(DEFAULT_CONFIG.engines),
  chop: ChopSchema.default(DEFAULT_CONFIG.chop),
  toon: ToonSchema.default(DEFAULT_CONFIG.toon),
  statusline: StatuslineSchema.default(DEFAULT_CONFIG.statusline),
  handoff: HandoffSchema.default(DEFAULT_CONFIG.handoff),
  report: ReportSchema.default(DEFAULT_CONFIG.report),
  telemetry: TelemetrySchema.default(DEFAULT_CONFIG.telemetry),
  kompress: KompressSchema.default(DEFAULT_CONFIG.kompress),
});

export type OptiflowConfig = z.infer<typeof OptiflowConfigSchema>;
