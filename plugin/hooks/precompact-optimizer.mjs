import { createRequire as __optiflowCreateRequire } from "node:module";
import { fileURLToPath as __optiflowFileURLToPath } from "node:url";
import { dirname as __optiflowDirname } from "node:path";
const require = __optiflowCreateRequire(import.meta.url);
const __filename = __optiflowFileURLToPath(import.meta.url);
const __dirname = __optiflowDirname(__filename);

// src/optimizer/hooks/precompact.ts
import { pathToFileURL } from "node:url";
import { join as join4 } from "node:path";

// src/core/hook-io.ts
var DEFAULT_OUTPUT_CAP_CHARS = 1e4;
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
function findLongestStringPath(value, currentPath = [], best = {
  path: null,
  len: -1
}) {
  if (typeof value === "string") {
    if (value.length > best.len) {
      best.len = value.length;
      best.path = currentPath.slice();
    }
  } else if (Array.isArray(value)) {
    value.forEach(
      (item, index) => findLongestStringPath(item, [...currentPath, index], best)
    );
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      findLongestStringPath(
        value[key],
        [...currentPath, key],
        best
      );
    }
  }
  return best.path;
}
function getAtPath(obj, pathParts) {
  return pathParts.reduce((acc, key) => {
    if (acc === null || typeof acc !== "object") return void 0;
    return acc[key];
  }, obj);
}
function setAtPath(obj, pathParts, value) {
  if (pathParts.length === 0) return;
  const parentPath = pathParts.slice(0, -1);
  const lastKey = pathParts[pathParts.length - 1];
  const parent = parentPath.length === 0 ? obj : getAtPath(obj, parentPath);
  if (parent && typeof parent === "object") {
    parent[lastKey] = value;
  }
}
function toCappedJson(value, capChars = DEFAULT_OUTPUT_CAP_CHARS) {
  const full = JSON.stringify(value);
  if (full.length <= capChars) return full;
  const clone = JSON.parse(full);
  const targetPath = findLongestStringPath(clone);
  if (!targetPath) {
    return full;
  }
  const originalStr = String(getAtPath(clone, targetPath));
  let str = originalStr;
  let serialized = full;
  for (let attempt = 0; attempt < 15; attempt++) {
    const omitted = originalStr.length - str.length;
    const marker = `...[truncated, ${omitted} chars omitted]`;
    setAtPath(clone, targetPath, omitted > 0 ? str + marker : str);
    serialized = JSON.stringify(clone);
    if (serialized.length <= capChars) break;
    const over = serialized.length - capChars;
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
    const marker = `...[truncated, ${originalStr.length} chars omitted]`;
    setAtPath(clone, targetPath, marker);
    serialized = JSON.stringify(clone);
  }
  return serialized;
}
function writeHookOutput(output, capChars = DEFAULT_OUTPUT_CAP_CHARS, stdout = process.stdout) {
  stdout.write(toCappedJson(output, capChars));
}

// src/optimizer/hooks/lib/policy.ts
import {
  statSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

// src/optimizer/hooks/lib/paths.ts
import { isAbsolute } from "node:path";
var MSYS = /^\/([A-Za-z])\/(.*)$/;
function normaliseOnce(input, cwd) {
  if (typeof input !== "string" || !input) return input;
  let path3 = input.trim();
  if (!path3) return input;
  if (path3.length >= 2 && (path3.startsWith('"') && path3.endsWith('"') || path3.startsWith("'") && path3.endsWith("'"))) {
    path3 = path3.slice(1, -1);
  }
  path3 = path3.replace(/\\/g, "/");
  if (!isAbsolute(path3) && !/^[A-Za-z]:/.test(path3)) {
    if (cwd) {
      const base = canonicalPath(cwd);
      path3 = `${base.endsWith("/") ? base.slice(0, -1) : base}/${path3}`;
    }
  }
  const unc = path3.startsWith("//");
  path3 = (unc ? path3.slice(2) : path3).replace(/\/{2,}/g, "/");
  const segments = [];
  for (const segment of path3.split("/")) {
    if (segment === "." || segment === "") {
      if (segments.length === 0 && segment === "") segments.push("");
      continue;
    }
    if (segment === ".." && segments.length && segments[segments.length - 1] !== "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  path3 = (unc ? "//" : "") + segments.join("/");
  if (path3 === "" && segments.length === 1 && segments[0] === "") path3 = "/";
  path3 = path3.trim();
  const msys = MSYS.exec(path3);
  if (msys) path3 = `${msys[1].toUpperCase()}:/${msys[2]}`;
  path3 = path3.replace(/^([A-Za-z]):/, (_, drive) => `${drive.toUpperCase()}:`);
  if (path3.length > 3 && path3.endsWith("/")) path3 = path3.slice(0, -1);
  return path3;
}
function isFsSafePath(input) {
  if (typeof input !== "string") return false;
  for (const character of input) {
    if (character.codePointAt(0) === 1114111) return false;
  }
  return true;
}
function canonicalPath(input, cwd) {
  let path3 = normaliseOnce(input, cwd);
  for (let i = 0; i < 8; i++) {
    const next = normaliseOnce(path3, cwd);
    if (next === path3) return path3;
    path3 = next;
  }
  return path3;
}

// src/optimizer/hooks/lib/policy.ts
var MODE_ENFORCE = "enforce";
var MODE_ADVISE = "advise";
var MODE_OFF = "off";
function mode(env = process.env) {
  const raw = (env.TOKEN_OPTIMIZER_MODE || "").trim().toLowerCase();
  if (raw === MODE_OFF) return MODE_OFF;
  if (raw === MODE_ADVISE) return MODE_ADVISE;
  return MODE_ENFORCE;
}
var PENDING_REDIRECT_TTL_MS = 5 * 6e4;
var stateRoot = (env = process.env) => env.TOKEN_OPTIMIZER_STATE_DIR || join(tmpdir(), "token-optimizer-hooks");
function statePath(sessionId, agent, env = process.env) {
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9_-]/g, "");
  const scope = agent ? `-${createHash("sha256").update(String(agent)).digest("hex").slice(0, 12)}` : "";
  return join(stateRoot(env), `${safe || "default"}${scope}.json`);
}
function emptyState() {
  return {
    seen: {},
    pendingRedirects: {},
    unmeasuredRedirects: 0,
    denied: {},
    injected: [],
    actCounts: {},
    forecast: null,
    edits: 0,
    editedFiles: [],
    harvestedEdits: 0,
    recordingNudged: false,
    optimizerTools: [],
    optimizerToolsObservedAt: 0
  };
}
function normalizeSeen(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === true) {
      out[key] = { hash: "", at: 0 };
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entry = value;
      out[key] = {
        hash: typeof entry.hash === "string" ? entry.hash : "",
        at: Number.isFinite(entry.at) ? Number(entry.at) : 0
      };
    }
  }
  return out;
}
function normalizePendingRedirects(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [tool, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value;
    if (!Number.isFinite(entry.avoidedBytes) || !Number.isFinite(entry.at)) continue;
    out[tool] = { avoidedBytes: Number(entry.avoidedBytes), at: Number(entry.at) };
  }
  return out;
}
function loadState(sessionId, agent, env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId, agent, env), "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyState();
    return {
      seen: normalizeSeen(parsed.seen),
      pendingRedirects: normalizePendingRedirects(parsed.pendingRedirects),
      unmeasuredRedirects: Number.isFinite(parsed.unmeasuredRedirects) ? Number(parsed.unmeasuredRedirects) : 0,
      denied: parsed.denied && typeof parsed.denied === "object" ? parsed.denied : {},
      injected: Array.isArray(parsed.injected) ? parsed.injected : [],
      actCounts: parsed.actCounts && typeof parsed.actCounts === "object" && !Array.isArray(parsed.actCounts) ? parsed.actCounts : {},
      forecast: parsed.forecast && typeof parsed.forecast === "object" && !Array.isArray(parsed.forecast) && Number.isFinite(parsed.forecast.checkedAt) ? parsed.forecast : null,
      edits: Number.isFinite(parsed.edits) ? parsed.edits : 0,
      editedFiles: Array.isArray(parsed.editedFiles) ? parsed.editedFiles : [],
      harvestedEdits: Number.isFinite(parsed.harvestedEdits) ? parsed.harvestedEdits : 0,
      recordingNudged: parsed.recordingNudged === true,
      optimizerTools: Array.isArray(parsed.optimizerTools) ? parsed.optimizerTools.filter((name) => typeof name === "string") : [],
      optimizerToolsObservedAt: Number.isFinite(parsed.optimizerToolsObservedAt) ? parsed.optimizerToolsObservedAt : 0
    };
  } catch {
    return emptyState();
  }
}
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
  }
}
function takeLock(sessionId, agent, env, { attempts = 20, staleMs = 5e3, waitMs = 15 } = {}) {
  const path3 = `${statePath(sessionId, agent, env)}.lock`;
  for (let i = 0; i < attempts; i++) {
    try {
      const fd = openSync(path3, "wx", 384);
      closeSync(fd);
      return path3;
    } catch {
      try {
        if (Date.now() - statSync(path3).mtimeMs > staleMs) {
          unlinkSync(path3);
          continue;
        }
      } catch {
        continue;
      }
      if (i < attempts - 1) sleepSync(waitMs);
    }
  }
  return null;
}
function clearSeen(sessionId, agent, env = process.env) {
  let lock = null;
  try {
    mkdirSync(stateRoot(env), { recursive: true, mode: 448 });
    lock = takeLock(sessionId, agent, env);
    if (!lock) return false;
    const current = loadState(sessionId, agent, env);
    const cleared = { ...current, seen: {} };
    const target = statePath(sessionId, agent, env);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(cleared), { mode: 384 });
    renameSync(temporary, target);
    return true;
  } catch {
    return false;
  } finally {
    if (lock) {
      try {
        unlinkSync(lock);
      } catch {
      }
    }
  }
}

// src/optimizer/hooks/lib/inject.ts
function linkCoOccurrence(_dir, _sessionId, _paths, _options = {}) {
  return 0;
}

// src/optimizer/hooks/lib/wiki.ts
import {
  appendFileSync,
  readFileSync as readFileSync2,
  existsSync,
  mkdirSync as mkdirSync2,
  chmodSync,
  openSync as openSync2,
  closeSync as closeSync2,
  unlinkSync as unlinkSync2,
  statSync as statSync2,
  writeFileSync as writeFileSync2,
  renameSync as renameSync2
} from "node:fs";
import { join as join2, dirname } from "node:path";

// src/optimizer/paths.ts
import path2 from "node:path";

// src/core/paths.ts
import { homedir } from "node:os";
import path from "node:path";
function getOptiflowHome() {
  const override = process.env.OPTIFLOW_HOME;
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return path.join(homedir(), ".optiflow");
}

// src/optimizer/paths.ts
function getOptimizerHome() {
  return path2.join(getOptiflowHome(), "optimizer");
}
function getOptimizerUnrootedDir() {
  return path2.join(getOptimizerHome(), "unrooted");
}

// src/optimizer/hooks/lib/wiki.ts
function wikiDir(cwd) {
  return process.env.TOKEN_OPTIMIZER_WIKI_DIR || join2(cwd || process.cwd(), ".token-optimizer", "wiki");
}
function unrootedRoot() {
  return process.env.TOKEN_OPTIMIZER_UNROOTED_DIR || getOptimizerUnrootedDir();
}
function projectRootFor(filePath, fallback) {
  if (!isFsSafePath(filePath)) return fallback ? canonicalPath(fallback) : null;
  const MARKERS = [".git", ".hg", ".svn"];
  let dir = dirname(canonicalPath(filePath));
  for (let depth = 0; depth < 40 && dir; depth += 1) {
    for (const marker of MARKERS) {
      if (existsSync(join2(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return unrootedRoot();
}

// src/optimizer/hooks/lib/surface.ts
function closeForecast(_dir, _options = {}) {
  return false;
}

// src/optimizer/hooks/lib/recording.ts
import { readFileSync as readFileSync3, existsSync as existsSync2 } from "node:fs";
import { join as join3 } from "node:path";
var NUDGE_AFTER_EDITS = Number(process.env.TOKEN_OPTIMIZER_NUDGE_AFTER) || 8;
function findingCount(dir) {
  const path3 = join3(dir, "graph.jsonl");
  if (!existsSync2(path3)) return 0;
  let text;
  try {
    text = readFileSync3(path3, "utf8");
  } catch {
    return 0;
  }
  const seen = /* @__PURE__ */ new Set();
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const node = JSON.parse(line);
      if (node?.kind === "finding" && node.id) seen.add(node.id);
    } catch {
    }
  }
  return seen.size;
}
function compactionNudge(dir, { edits = 0 } = {}) {
  if (edits < 1) return null;
  if (findingCount(dir) > 0) return null;
  return "Compaction is about to discard this session's reasoning, and nothing was recorded to the graph. If you concluded anything durable -- a dead end, a decision and its rejected alternative, an invocation that worked -- call wiki_write with a file anchor before it goes.";
}

// src/optimizer/hooks/lib/capabilities.ts
var HOOK_MCP_TOOLS = [
  "smart_read",
  "smart_write",
  "smart_edit",
  "smart_glob",
  "smart_grep",
  "optimize_session",
  "get_optimization_report",
  "wiki_write"
];
var HOOK_MCP_TOOL_SET = new Set(HOOK_MCP_TOOLS);
function parseOverride(override) {
  const names = /* @__PURE__ */ new Set();
  let parsed = null;
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
function optimizerToolsForHook(_raw = {}, state = null, env = process.env) {
  const override = env.TOKEN_OPTIMIZER_MCP_CAPABILITIES;
  if (override !== void 0) {
    return { proven: true, names: parseOverride(override) };
  }
  const observed = Array.isArray(state?.optimizerTools) ? state.optimizerTools.filter((name) => HOOK_MCP_TOOL_SET.has(name)) : [];
  if (observed.length > 0) {
    return { proven: true, names: new Set(observed) };
  }
  return { proven: false, names: new Set(HOOK_MCP_TOOLS) };
}

// src/optimizer/hooks/lib/observability.ts
function hookDeadlineMs(env = process.env) {
  const parsed = Number(env.TOKEN_OPTIMIZER_HOOK_DEADLINE_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4200;
}

// src/optimizer/hooks/precompact.ts
function decidePreCompact(raw) {
  if (!raw) return {};
  try {
    if (mode() === MODE_OFF) return {};
    const sessionId = raw.session_id ?? "default";
    const cwd = raw.cwd || process.cwd();
    const transcriptPath = raw.transcript_path ?? null;
    const state = loadState(sessionId, transcriptPath);
    const seen = Object.keys(state.seen || {});
    if (seen.length === 0) return {};
    try {
      const byProject = /* @__PURE__ */ new Map();
      for (const path3 of seen) {
        const root = projectRootFor(path3, cwd);
        if (!root) continue;
        if (!byProject.has(root)) byProject.set(root, []);
        byProject.get(root).push(path3);
      }
      for (const [root, paths] of byProject) {
        if (paths.length < 2) continue;
        linkCoOccurrence(wikiDir(root), sessionId, paths);
      }
    } catch {
    }
    clearSeen(sessionId, transcriptPath);
    let systemMessage;
    try {
      const graphDir = wikiDir(projectRootFor(join4(cwd, "x"), cwd) ?? cwd);
      const refreshedState = loadState(sessionId, transcriptPath);
      const tools = optimizerToolsForHook(raw, refreshedState);
      const nudge = tools.names.has("wiki_write") ? compactionNudge(graphDir, { edits: refreshedState.edits || 0 }) : null;
      if (nudge) systemMessage = nudge;
    } catch {
    }
    try {
      closeForecast(wikiDir(projectRootFor(join4(cwd, "x"), cwd) ?? cwd), {
        transcriptPath,
        sessionId
      });
    } catch {
    }
    return systemMessage ? { systemMessage } : {};
  } catch {
    return {};
  }
}
async function runPreCompact(readInput) {
  const raw = await readInput();
  return decidePreCompact(raw);
}
async function main() {
  const deadline = new Promise((resolve) => {
    setTimeout(() => resolve({}), hookDeadlineMs()).unref?.();
  });
  const output = await Promise.race([
    runPreCompact(() => readHookInput()),
    deadline
  ]);
  writeHookOutput(output);
}
var entryArg = process.argv[1];
var isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;
if (isDirectRun) {
  main();
}
export {
  decidePreCompact,
  runPreCompact
};
//# sourceMappingURL=precompact-optimizer.mjs.map
