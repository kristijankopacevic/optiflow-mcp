// src/statusline/segments.ts
function meterSegment(usedPercentage, exceedsLimit, width) {
  const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : 10;
  const flag = exceedsLimit ? " \u26A0" : "";
  if (usedPercentage === null || usedPercentage === void 0 || !Number.isFinite(usedPercentage)) {
    return `[${"\u2591".repeat(w)}] --%${flag}`;
  }
  const clamped = Math.min(100, Math.max(0, usedPercentage));
  const filled = Math.min(w, Math.max(0, Math.round(clamped / 100 * w)));
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(w - filled);
  return `[${bar}] ${Math.round(clamped)}%${flag}`;
}
function modelSegment(model) {
  const name = model?.display_name || model?.id;
  return name ? String(name) : "unknown-model";
}
function costSegment(totalCostUsd) {
  if (totalCostUsd === null || totalCostUsd === void 0 || !Number.isFinite(totalCostUsd)) {
    return "";
  }
  return `$${totalCostUsd.toFixed(2)}`;
}
function activitySegment(activity, now, staleMs) {
  if (!activity) return "";
  const tool = activity.tool;
  if (typeof tool !== "string" || tool.length === 0) return "";
  const ts = activity.timestamp;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
  const age = now - ts;
  if (age > staleMs) return "";
  return `\u2699 ${tool}`;
}
function formatTokenCount(n) {
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}
function savingsSegment(savings) {
  if (!savings || !Number.isFinite(savings.tokensSaved) || savings.tokensSaved <= 0) {
    return "";
  }
  return `\u267B ~${formatTokenCount(savings.tokensSaved)} tok saved (recent)`;
}

// src/statusline/render.ts
var ALL_SEGMENTS = [
  "meter",
  "model",
  "cost",
  "activity",
  "savings"
];
var DEFAULT_RENDER_CONFIG = {
  enabled: true,
  segments: [...ALL_SEGMENTS],
  meterWidth: 10,
  activityStaleMs: 5e3
};
function resolveConfig(partial) {
  return {
    enabled: partial?.enabled ?? DEFAULT_RENDER_CONFIG.enabled,
    segments: partial?.segments ?? DEFAULT_RENDER_CONFIG.segments,
    meterWidth: partial?.meterWidth ?? DEFAULT_RENDER_CONFIG.meterWidth,
    activityStaleMs: partial?.activityStaleMs ?? DEFAULT_RENDER_CONFIG.activityStaleMs
  };
}
var SEGMENT_SEPARATOR = " \u2502 ";
function render(input = {}, ctx = {}) {
  const config = resolveConfig(ctx.config);
  if (!config.enabled) return "";
  const now = ctx.now ?? Date.now();
  const parts = [];
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
export {
  ALL_SEGMENTS,
  DEFAULT_RENDER_CONFIG,
  render
};
//# sourceMappingURL=render.js.map
