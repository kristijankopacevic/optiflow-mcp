// Zod schema validating the optiflow.config.json shape.
//
// Deliberately NOT `.strict()` anywhere: an unknown key (e.g. from a future
// phase's config section, or a typo) must not collapse the whole config to
// defaults. Zod's default object behavior already strips unknown keys, which
// combined with load.ts's stderr warning on real validation failures is the
// "fail open, never crash a hook over malformed config" shape this needs.

import { z } from "zod";
import { DEFAULT_CONFIG } from "./defaults.js";

// v2 cleanup: `engines.tokenOptimizer`/`engines.headroom` (mode: "npx"/
// "disabled", "path"/"disabled", a version pin, a PATH binary name) used to
// configure how v1 invoked each upstream as a separate process. Removed —
// both are genuinely merged into this codebase now (src/optimizer/**,
// native/headroom-core/), so there is no external process/version/binary
// left to configure. See docs/ADR/0002-real-merge-not-orchestration.md.

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

// v3 addition: MCP tool-RESULT compression, split out of `chop.enabled`.
// See defaults.ts for why this defaults `true` while chop stays `false`.
export const McpCompressionSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.mcpCompression.enabled),
  minOutputBytes: z
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_CONFIG.mcpCompression.minOutputBytes),
});

// v2 Phase 5c addition ("wire the native compression modules in"). See
// `src/config/defaults.ts`'s doc comment on `smartCrusher` for why this
// defaults `enabled: true` (unlike `kompress`, which is opt-in due to its
// model-download cost that SmartCrusher doesn't share).
export const SmartCrusherSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.smartCrusher.enabled),
  minSavingsPercent: z.number().min(0).max(100).default(DEFAULT_CONFIG.smartCrusher.minSavingsPercent),
});

export const OptiflowConfigSchema = z.object({
  chop: ChopSchema.default(DEFAULT_CONFIG.chop),
  toon: ToonSchema.default(DEFAULT_CONFIG.toon),
  statusline: StatuslineSchema.default(DEFAULT_CONFIG.statusline),
  handoff: HandoffSchema.default(DEFAULT_CONFIG.handoff),
  report: ReportSchema.default(DEFAULT_CONFIG.report),
  telemetry: TelemetrySchema.default(DEFAULT_CONFIG.telemetry),
  kompress: KompressSchema.default(DEFAULT_CONFIG.kompress),
  mcpCompression: McpCompressionSchema.default(DEFAULT_CONFIG.mcpCompression),
  smartCrusher: SmartCrusherSchema.default(DEFAULT_CONFIG.smartCrusher),
});

export type OptiflowConfig = z.infer<typeof OptiflowConfigSchema>;
