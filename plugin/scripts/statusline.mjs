import { createRequire as __optiflowCreateRequire } from "node:module";
import { fileURLToPath as __optiflowFileURLToPath } from "node:url";
import { dirname as __optiflowDirname } from "node:path";
const require = __optiflowCreateRequire(import.meta.url);
const __filename = __optiflowFileURLToPath(import.meta.url);
const __dirname = __optiflowDirname(__filename);

// src/statusline/cli.ts
import { pathToFileURL } from "node:url";

// src/core/hook-io.ts
async function readHookInput(stdin = process.stdin) {
  try {
    const chunks = [];
    for await (const chunk of stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (raw.length === 0) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

// src/statusline/io.ts
import { closeSync, existsSync as existsSync2, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import path2 from "node:path";

// src/core/paths.ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
function getOptiflowHome() {
  const override = process.env.OPTIFLOW_HOME;
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return path.join(homedir(), ".optiflow");
}
function findProjectRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, ".git")) || existsSync(path.join(dir, "optiflow.config.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(startDir);
    }
    dir = parent;
  }
}

// src/statusline/io.ts
var LEDGER_TAIL_BYTES = 8192;
var RECENT_SAVINGS_WINDOW_MS = 6 * 60 * 60 * 1e3;
function readJsonObject(filePath) {
  try {
    if (!existsSync2(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function isSegmentName(value) {
  return typeof value === "string" && ALL_SEGMENTS.includes(value);
}
function coerceStatuslineSection(raw) {
  if (!raw || typeof raw !== "object") return {};
  const r = raw;
  const out = {};
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (Array.isArray(r.segments) && r.segments.length > 0 && r.segments.every(isSegmentName)) {
    out.segments = r.segments;
  }
  if (typeof r.meterWidth === "number" && Number.isFinite(r.meterWidth) && r.meterWidth > 0) {
    out.meterWidth = r.meterWidth;
  }
  if (typeof r.activityStaleMs === "number" && Number.isFinite(r.activityStaleMs) && r.activityStaleMs >= 0) {
    out.activityStaleMs = r.activityStaleMs;
  }
  return out;
}
function readStatuslineConfig(options = {}) {
  try {
    const home = options.home ?? getOptiflowHome();
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = findProjectRoot(cwd);
    const userGlobal = readJsonObject(path2.join(home, "config.json"));
    const project = readJsonObject(path2.join(projectRoot, "optiflow.config.json"));
    return {
      ...coerceStatuslineSection(userGlobal?.statusline),
      ...coerceStatuslineSection(project?.statusline)
    };
  } catch {
    return {};
  }
}
function readActivityBeacon(options = {}) {
  try {
    const home = options.home ?? getOptiflowHome();
    const file = path2.join(home, "activity.json");
    if (!existsSync2(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const tool = typeof parsed.tool === "string" ? parsed.tool : null;
    const timestamp = typeof parsed.timestamp === "number" ? parsed.timestamp : null;
    if (!tool || timestamp === null) return null;
    return { tool, timestamp };
  } catch {
    return null;
  }
}
function readRecentSavings(options = {}) {
  try {
    const home = options.home ?? getOptiflowHome();
    const now = options.now ?? Date.now();
    const file = path2.join(home, "ledger.jsonl");
    if (!existsSync2(file)) return null;
    let raw;
    let position;
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      if (size === 0) return null;
      const length = Math.min(size, LEDGER_TAIL_BYTES);
      position = Math.max(0, size - LEDGER_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      const bytesRead = readSync(fd, buffer, 0, length, position);
      raw = buffer.toString("utf8", 0, bytesRead);
    } finally {
      closeSync(fd);
    }
    const lines = raw.split("\n");
    if (position > 0) {
      lines.shift();
    }
    const cutoff = now - RECENT_SAVINGS_WINDOW_MS;
    let tokensSaved = 0;
    let recordCount = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed);
        if (!record || typeof record !== "object") continue;
        const timestamp = typeof record.timestamp === "string" ? new Date(record.timestamp).getTime() : NaN;
        if (Number.isNaN(timestamp) || timestamp < cutoff) continue;
        const before = typeof record.tokensBefore === "number" ? record.tokensBefore : NaN;
        const after = typeof record.tokensAfter === "number" ? record.tokensAfter : NaN;
        if (Number.isNaN(before) || Number.isNaN(after)) continue;
        tokensSaved += Math.max(0, before - after);
        recordCount += 1;
      } catch {
        continue;
      }
    }
    if (recordCount === 0) return null;
    return { tokensSaved, recordCount };
  } catch {
    return null;
  }
}

// src/statusline/cli.ts
async function runStatusline(readInput = () => readHookInput(), ioOptions = {}) {
  const input = await readInput() ?? {};
  const config = { ...DEFAULT_RENDER_CONFIG, ...readStatuslineConfig(ioOptions) };
  const activity = readActivityBeacon(ioOptions);
  const savings = readRecentSavings(ioOptions);
  return render(input, { config, activity, savings, now: ioOptions.now });
}
async function main() {
  const output = await runStatusline();
  process.stdout.write(output);
}
var entryArg = process.argv[1];
var isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;
if (isDirectRun) {
  main();
}
export {
  runStatusline
};
//# sourceMappingURL=statusline.mjs.map
