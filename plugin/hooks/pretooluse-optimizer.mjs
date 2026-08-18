// src/optimizer/hooks/pretooluse.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { pathToFileURL } from "node:url";

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
function allow(hookEventName, reason) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      ...reason ? { permissionDecisionReason: reason } : {}
    }
  };
}
function deny(hookEventName, reason) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}
function allowWithContext(hookEventName, context) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      additionalContext: context
    }
  };
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
function resolvableCandidates(input, cwd) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const add = (p) => {
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  add(canonicalPath(input, cwd));
  if (typeof input === "string") add(input);
  if (cwd && typeof input === "string" && !isAbsolute(input) && !/^[A-Za-z]:/.test(input)) {
    add(`${cwd}/${input}`);
  }
  return out;
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
function intEnv(env, name, fallback) {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function largeFileBytes(env = process.env) {
  return intEnv(env, "TOKEN_OPTIMIZER_LARGE_READ_BYTES", 25600);
}
function refusalFloorBytes(env = process.env) {
  return intEnv(env, "TOKEN_OPTIMIZER_REFUSAL_FLOOR_BYTES", 1024);
}
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".mp3",
  ".mp4",
  ".wav",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot"
]);
function isBinaryPath(path3) {
  const dot = path3.lastIndexOf(".");
  return dot !== -1 && BINARY_EXTENSIONS.has(path3.slice(dot).toLowerCase());
}
var MACHINE_OWNED = /(?:^|[/\\])(?:\.git|\.hg|\.svn|node_modules|\.venv|__pycache__|\.next|\.turbo|dist|obj|bin)(?:[/\\]|$)/i;
function normalizeSegments(p) {
  const drive = /^[a-z]:/i.test(p) ? p.slice(0, 2) : "";
  const rest = drive ? p.slice(2) : p;
  const rooted = rest.startsWith("/");
  const out = [];
  for (const seg of rest.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!rooted && !drive) out.push("..");
      continue;
    }
    out.push(seg);
  }
  return drive + (rooted || drive ? "/" : "") + out.join("/");
}
function isMachineOwned(path3) {
  return MACHINE_OWNED.test(
    normalizeSegments(String(path3 || "").split("\\").join("/"))
  );
}
function fileSize(path3) {
  if (!isFsSafePath(path3)) return -1;
  try {
    const st = statSync(path3);
    return st.isFile() ? st.size : -1;
  } catch {
    return -1;
  }
}
var stateRoot = (env = process.env) => env.TOKEN_OPTIMIZER_STATE_DIR || join(tmpdir(), "token-optimizer-hooks");
function statePath(sessionId, agent, env = process.env) {
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9_-]/g, "");
  const scope = agent ? `-${createHash("sha256").update(String(agent)).digest("hex").slice(0, 12)}` : "";
  return join(stateRoot(env), `${safe || "default"}${scope}.json`);
}
function emptyState() {
  return {
    seen: {},
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
function loadState(sessionId, agent, env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId, agent, env), "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyState();
    return {
      seen: parsed.seen && typeof parsed.seen === "object" ? parsed.seen : {},
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
function saveState(sessionId, state, agent, env = process.env) {
  let lock = null;
  try {
    mkdirSync(stateRoot(env), { recursive: true, mode: 448 });
    lock = takeLock(sessionId, agent, env);
    if (!lock) return false;
    const current = loadState(sessionId, agent, env);
    const merged = {
      seen: { ...current.seen, ...state.seen },
      denied: { ...current.denied, ...state.denied },
      injected: [.../* @__PURE__ */ new Set([...current.injected || [], ...state.injected || []])],
      actCounts: (() => {
        const out = { ...current.actCounts || {} };
        for (const [k, v] of Object.entries(state.actCounts || {})) {
          out[k] = Math.max(Number(out[k]) || 0, Number(v) || 0);
        }
        return out;
      })(),
      edits: Math.max(Number(current.edits) || 0, Number(state.edits) || 0),
      editedFiles: [.../* @__PURE__ */ new Set([...state.editedFiles || [], ...current.editedFiles || []])].slice(0, 20),
      harvestedEdits: Math.max(Number(current.harvestedEdits) || 0, Number(state.harvestedEdits) || 0),
      recordingNudged: Boolean(current.recordingNudged || state.recordingNudged),
      ...(() => {
        const mineAt = Number(state.optimizerToolsObservedAt) || 0;
        const theirsAt = Number(current.optimizerToolsObservedAt) || 0;
        const mineWins = mineAt >= theirsAt && mineAt > 0;
        return {
          optimizerTools: mineWins ? [...state.optimizerTools || []] : [...current.optimizerTools || []],
          optimizerToolsObservedAt: mineWins ? mineAt : theirsAt
        };
      })(),
      forecast: (() => {
        const mine = state.forecast || null;
        const theirs = current.forecast || null;
        const stamp = (f) => Number.isFinite(f?.checkedAt) ? f.checkedAt : null;
        if (stamp(mine) === null) return theirs;
        if (stamp(theirs) === null) return mine;
        return stamp(mine) >= stamp(theirs) ? mine : theirs;
      })()
    };
    const target = statePath(sessionId, agent, env);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(merged), { mode: 384 });
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
function alreadyDenied(state, key) {
  const seen = Boolean(state.denied[key]);
  state.denied[key] = true;
  return seen;
}
function withEscape(reason) {
  const text = String(reason || "");
  if (text.includes("TOKEN_OPTIMIZER_MODE")) return text;
  return `${text} (Not what you wanted? TOKEN_OPTIMIZER_MODE=off disables enforcement.)`;
}
function enforceVerdict(reason, deniedBefore, currentMode = mode()) {
  if (currentMode === MODE_OFF) return { kind: "allow" };
  if (currentMode === MODE_ADVISE || deniedBefore) {
    return { kind: "allowWithContext", context: reason };
  }
  return { kind: "deny", reason: withEscape(reason) };
}

// src/optimizer/hooks/lib/decide.ts
import { statSync as statSync3 } from "node:fs";
import { join as join4 } from "node:path";

// src/optimizer/hooks/lib/remedy.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
function rulesPath(dir) {
  return join2(dir, "rules.json");
}
function activeRules(dir) {
  try {
    const parsed = JSON.parse(readFileSync2(rulesPath(dir), "utf8"));
    return Array.isArray(parsed?.rules) ? parsed.rules.filter((r) => !r.revertedAt) : [];
  } catch {
    return [];
  }
}

// src/optimizer/hooks/lib/wiki.ts
import {
  appendFileSync,
  readFileSync as readFileSync3,
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
import { join as join3, dirname } from "node:path";
import { createHash as createHash2 } from "node:crypto";

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
var GRAPH_VERSION = 1;
var NODE_KINDS = ["file", "symbol", "task", "finding"];
var EDGE_KINDS = [
  "derived_from",
  "contains",
  "imports",
  "calls",
  "supersedes",
  "contradicts",
  "answers",
  "related"
];
function wikiDir(cwd) {
  return process.env.TOKEN_OPTIMIZER_WIKI_DIR || join3(cwd || process.cwd(), ".token-optimizer", "wiki");
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
      if (existsSync(join3(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return unrootedRoot();
}
var logPath = (dir) => join3(dir, "graph.jsonl");
var snapshotsPath = (dir) => join3(dir, "snapshots.jsonl");
var markerPath = (dir) => join3(dir, "graph.compact.json");
function nodeId(kind, key) {
  return `${kind}:${createHash2("sha256").update(canonicalKey(kind, key)).digest("hex").slice(0, 16)}`;
}
function canonicalKey(kind, key) {
  const raw = String(key);
  if (kind === "file") return canonicalPath(raw);
  if (kind === "symbol") {
    const hash = raw.indexOf("#");
    return hash === -1 ? canonicalPath(raw) : `${canonicalPath(raw.slice(0, hash))}#${raw.slice(hash + 1)}`;
  }
  return raw;
}
function contentHash(path3, text) {
  if (text === void 0 && !isFsSafePath(path3)) return null;
  try {
    return createHash2("sha256").update(text === void 0 ? readFileSync3(path3) : text).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}
function withLock(dir, write) {
  const lockPath = join3(dir, ".graph.lock");
  let held = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      closeSync2(openSync2(lockPath, "wx", 384));
      held = true;
      break;
    } catch {
      try {
        if (Date.now() - statSync2(lockPath).mtimeMs > 5e3) unlinkSync2(lockPath);
      } catch {
      }
    }
  }
  try {
    write();
  } finally {
    if (held) {
      try {
        unlinkSync2(lockPath);
      } catch {
      }
    }
  }
}
function ignoreSelf(dir) {
  const marker = join3(dir, ".gitignore");
  try {
    if (existsSync(marker)) return;
    appendFileSync(
      marker,
      "# Written by the optiflow optimizer. Findings are unreviewed agent output;\n# keeping them out of git history is the default. Delete this file to\n# opt in to committing them.\n*\n"
    );
  } catch {
  }
}
var compactFloorBytes = () => Number(process.env.TOKEN_OPTIMIZER_GRAPH_COMPACT_BYTES) || 8e6;
var SNAPSHOT_DEPENDENT = /* @__PURE__ */ new Set(["finding", "map"]);
var snapshotBudgetBytes = () => Number(process.env.TOKEN_OPTIMIZER_GRAPH_SNAPSHOT_BYTES) || 8e6;
function compactionBaseline(dir) {
  try {
    const raw = JSON.parse(readFileSync3(markerPath(dir), "utf8"));
    const n = Number(raw.sizeAfter);
    return Number.isFinite(n) && n > 0 ? n : compactFloorBytes();
  } catch {
    return compactFloorBytes();
  }
}
function readSnapshots(dir) {
  const out = [];
  try {
    for (const line of readFileSync3(snapshotsPath(dir), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if ((rec.v ?? 0) === GRAPH_VERSION && rec.id) out.push(rec);
      } catch {
      }
    }
  } catch {
  }
  return out;
}
function compactIfWasteful(dir) {
  const path3 = logPath(dir);
  let size = 0;
  try {
    size = statSync2(path3).size;
  } catch {
    return;
  }
  try {
    size += statSync2(snapshotsPath(dir)).size;
  } catch {
  }
  if (size < compactFloorBytes() || size < compactionBaseline(dir) * 2) return;
  try {
    const nodes = /* @__PURE__ */ new Map();
    const edges = /* @__PURE__ */ new Map();
    const snaps = /* @__PURE__ */ new Map();
    for (const rec of readSnapshots(dir)) {
      if (typeof rec.snapshot === "string" && rec.snapshot) {
        snaps.set(rec.id, { at: rec.at || 0, snapshot: rec.snapshot });
      }
    }
    for (const line of readFileSync3(path3, "utf8").split("\n")) {
      if (!line) continue;
      let record2;
      try {
        record2 = JSON.parse(line);
      } catch {
        continue;
      }
      if ((record2.v ?? 0) !== GRAPH_VERSION) {
        edges.set("raw:" + edges.size, line);
        continue;
      }
      if (record2.t === "n") {
        if (typeof record2.snapshot === "string" && record2.snapshot) {
          const { snapshot, ...rest } = record2;
          nodes.set(record2.id, JSON.stringify(rest));
          snaps.set(record2.id, { at: record2.at || 0, snapshot });
        } else {
          nodes.set(record2.id, line);
        }
      } else if (record2.t === "s") {
        if (typeof record2.snapshot === "string" && record2.snapshot) {
          snaps.set(record2.id, { at: record2.at || 0, snapshot: record2.snapshot });
        }
      } else if (record2.t === "e") {
        edges.set(`${record2.from}|${record2.edge}|${record2.to}`, line);
      } else edges.set("raw:" + edges.size, line);
    }
    const needed = /* @__PURE__ */ new Set();
    for (const line of edges.values()) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.t !== "e" || e.edge !== "derived_from") continue;
      const from = nodes.get(e.from);
      if (!from) continue;
      let f;
      try {
        f = JSON.parse(from);
      } catch {
        continue;
      }
      if (f.kind === "finding" && SNAPSHOT_DEPENDENT.has(f.type || "finding")) {
        needed.add(e.to);
      }
    }
    const carriers = [...snaps.entries()].map(([id, v]) => ({ id, at: v.at, size: v.snapshot.length })).sort((a, b) => b.at - a.at);
    let spent = 0;
    const budget = snapshotBudgetBytes();
    const keep = /* @__PURE__ */ new Map();
    for (const c of carriers) {
      if (!needed.has(c.id) && spent + c.size > budget) continue;
      spent += c.size;
      keep.set(c.id, snaps.get(c.id));
    }
    const out = [...edges.values(), ...nodes.values()].join("\n") + "\n";
    const tmp = path3 + ".compact";
    writeFileSync2(tmp, out, { mode: 384 });
    renameSync2(tmp, path3);
    const snapOut = [...keep.entries()].map(([id, v]) => JSON.stringify({ t: "s", v: GRAPH_VERSION, id, snapshot: v.snapshot, at: v.at })).join("\n") + (keep.size ? "\n" : "");
    const snapTmp = snapshotsPath(dir) + ".compact";
    writeFileSync2(snapTmp, snapOut, { mode: 384 });
    renameSync2(snapTmp, snapshotsPath(dir));
    writeFileSync2(
      markerPath(dir),
      JSON.stringify({ sizeAfter: out.length + snapOut.length, at: Date.now() }),
      { mode: 384 }
    );
  } catch {
  }
}
function appendAll(dir, records) {
  if (!records.length) return true;
  try {
    mkdirSync2(dir, { recursive: true, mode: 448 });
    try {
      chmodSync(dir, 448);
    } catch {
    }
    ignoreSelf(dir);
    const payload = records.map((record2) => JSON.stringify(record2) + "\n").join("");
    withLock(dir, () => {
      appendFileSync(logPath(dir), payload);
      compactIfWasteful(dir);
    });
    return true;
  } catch {
    return false;
  }
}
function append(dir, record2) {
  return appendAll(dir, [record2]);
}
function putNode(dir, { kind, key, ...rest }) {
  if (!NODE_KINDS.includes(kind)) throw new Error(`unknown node kind: ${kind}`);
  const id = nodeId(kind, key);
  const { snapshot, ...fields } = rest;
  const at = Date.now();
  const records = [{ ...fields, t: "n", v: GRAPH_VERSION, id, kind, key: canonicalKey(kind, key), at }];
  appendAll(dir, records);
  if (typeof snapshot === "string" && snapshot) {
    appendSnapshotRecord(dir, { t: "s", v: GRAPH_VERSION, id, snapshot, at });
  }
  return id;
}
function putEdge(dir, from, edge, to) {
  if (!EDGE_KINDS.includes(edge)) throw new Error(`unknown edge kind: ${edge}`);
  append(dir, { t: "e", v: GRAPH_VERSION, from, edge, to, at: Date.now() });
}
function appendSnapshotRecord(dir, record2) {
  try {
    appendFileSync(snapshotsPath(dir), JSON.stringify(record2) + "\n");
  } catch {
  }
}
function load(dir, { snapshots = false } = {}) {
  const nodes = /* @__PURE__ */ new Map();
  const edges = [];
  const path3 = logPath(dir);
  if (!existsSync(path3)) return { nodes, edges };
  const pending = snapshots ? /* @__PURE__ */ new Map() : null;
  for (const line of readFileSync3(path3, "utf8").split("\n")) {
    if (!line) continue;
    if (line.startsWith('{"t":"s"')) {
      if (!snapshots) continue;
      try {
        const rec = JSON.parse(line);
        if ((rec.v ?? 0) === GRAPH_VERSION) pending.set(rec.id, rec.snapshot);
      } catch {
      }
      continue;
    }
    let record2;
    try {
      record2 = JSON.parse(line);
    } catch {
      continue;
    }
    if ((record2.v ?? 0) !== GRAPH_VERSION) continue;
    if (record2.t === "n") nodes.set(record2.id, record2);
    else if (record2.t === "e") edges.push(record2);
  }
  if (pending) {
    for (const rec of readSnapshots(dir)) pending.set(rec.id, rec.snapshot);
    for (const [id, snapshot] of pending) {
      const node = nodes.get(id);
      if (node) nodes.set(id, { ...node, snapshot });
    }
  }
  return { nodes, edges };
}
function harvest(dir, { filePath, sessionId, action, hash: precomputed }) {
  if (!filePath) return null;
  const hash = precomputed ?? contentHash(filePath);
  if (hash === null) return null;
  const fileNode = putNode(dir, { kind: "file", key: filePath, hash, lastAction: action });
  if (sessionId) {
    const taskNode = putNode(dir, { kind: "task", key: sessionId });
    putEdge(dir, taskNode, "derived_from", fileNode);
  }
  return fileNode;
}

// src/optimizer/hooks/lib/decide.ts
var KB = (bytes) => Math.round(bytes / 1024);
function isDirectory(path3) {
  if (!isFsSafePath(path3)) return false;
  try {
    return statSync3(path3).isDirectory();
  } catch {
    return false;
  }
}
var DUMP_COMMANDS = /\b(?:cat|bat|head|tail|more|less|type|Get-Content|gc)\b/;
var DUMP_HEAD = /^(?:cat|bat|head|tail|more|less|type|Get-Content|gc)$/i;
var RECURSIVE_SEARCH = /\b(?:grep|egrep|fgrep|rg|ag|ack|findstr|Select-String|sls)\b/;
var SEARCH_TOOL = /^(?:grep|egrep|fgrep|rg|ag|ack|findstr|Select-String|sls)$/i;
var RECURSES_BY_DEFAULT = /^(?:rg|ag|ack)$/i;
var COMMAND_PREFIX = /^(?:sudo|time|env|command|nice|ionice|nohup|xargs)$/;
function stripHeredocs(command) {
  const lines = String(command).split("\n");
  const out = [];
  let delimiter = null;
  for (const line of lines) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      continue;
    }
    out.push(line);
    const opener = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (opener) delimiter = opener[2];
  }
  return out.join("\n");
}
function segmentsOf(command) {
  return String(command).split(/\|\||&&|[|;&\n]/).map((s) => s.trim()).filter(Boolean);
}
function redirectsStdoutToFile(segment) {
  return /(?:^|[^0-9&2])>>?\s*(?!&)\S+/.test(String(segment));
}
function isContentDump(command) {
  if (typeof command !== "string") return false;
  const runnable = stripHeredocs(command);
  if (RECURSIVE_SEARCH.test(runnable)) return true;
  if (!DUMP_COMMANDS.test(runnable)) return false;
  return segmentsOf(runnable).some(
    (segment) => DUMP_COMMANDS.test(segment) && !redirectsStdoutToFile(segment)
  );
}
function shellSegments(command) {
  const out = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote && command[i - 1] !== "\\") quote = null;
      current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&") {
      if ((c === "|" || c === "&") && command[i + 1] === c) i++;
      out.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}
function isRecursiveSearch(command) {
  if (typeof command !== "string") return false;
  for (const segment of shellSegments(stripHeredocs(command))) {
    const tokens = segment.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g) || [];
    let i = 0;
    while (i < tokens.length && (/^\w+=/.test(tokens[i]) || COMMAND_PREFIX.test(tokens[i]))) i++;
    if (i >= tokens.length) continue;
    let head = tokens[i].replace(/^.*[/\\]/, "");
    if (head === "git" && tokens[i + 1] === "grep") {
      head = "grep";
      i++;
    }
    if (!SEARCH_TOOL.test(head)) continue;
    if (RECURSES_BY_DEFAULT.test(head)) return true;
    const flags = tokens.slice(i + 1);
    if (flags.some((t) => t === "--recursive" || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(t))) return true;
  }
  return false;
}
function fileOperands(command) {
  const operands = [];
  const segment = command.split("|")[0];
  const tokens = segment.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g) || [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i].replace(/^['"]|['"]$/g, "");
    if (token.startsWith("-")) {
      if (/^-[a-zA-Z]$/.test(token) && /^\d+$/.test(tokens[i + 1] || "")) i++;
      continue;
    }
    if (token.includes("*") || token.includes("$") || token.startsWith("<")) continue;
    operands.push(token);
  }
  return operands;
}
function candidatePaths(operand, cwd) {
  return resolvableCandidates(operand, cwd);
}
function commandProjectRoot(payload, fallback) {
  const raw = payload?.tool_input?.command;
  const base = payload?.cwd ?? fallback;
  if (typeof raw === "string") {
    const command = stripHeredocs(raw);
    const cd = /(?:^|\n|;|&&)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(command);
    if (cd) {
      const target = canonicalPath(cd[1].replace(/^['"]|['"]$/g, ""), base);
      if (isDirectory(target)) return projectRootFor(join4(target, "__command__"), base);
    }
  }
  return projectRootFor(join4(base || process.cwd(), "__command__"), base);
}
function touchedFiles(payload) {
  const input = payload?.tool_input || {};
  const out = /* @__PURE__ */ new Map();
  const command = typeof input.command === "string" ? stripHeredocs(input.command) : "";
  const cd = /(?:^|\n|;|&&)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(command);
  const cdTarget = cd ? canonicalPath(cd[1].replace(/^['"]|['"]$/g, ""), payload?.cwd) : null;
  const cwd = cdTarget && isDirectory(cdTarget) ? cdTarget : payload?.cwd;
  const add = (candidate) => {
    if (!candidate || typeof candidate !== "string") return;
    for (const spelling of resolvableCandidates(candidate, cwd)) {
      if (!isFsSafePath(spelling)) continue;
      const size = fileSize(spelling);
      if (size >= 0) {
        if (!isMachineOwned(spelling)) out.set(canonicalPath(spelling, cwd), size);
        return;
      }
    }
  };
  add(input.file_path);
  add(input.path);
  add(input.notebook_path);
  for (const match of command.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm)) {
    add(match[1].trim().replace(/^['"]|['"]$/g, ""));
  }
  for (const match of command.matchAll(/^\*\*\* Move to:\s*(.+)$/gm)) {
    add(match[1].trim().replace(/^['"]|['"]$/g, ""));
  }
  for (const segment of command.split("|")) {
    for (const operand of fileOperands(segment)) add(operand);
  }
  return [...out].map(([path3, size]) => ({ path: path3, size }));
}
function largeDumpedOperand(command, cwd) {
  const threshold = largeFileBytes();
  for (const segment of shellSegments(stripHeredocs(command))) {
    const tokens = segment.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g) || [];
    let i = 0;
    while (i < tokens.length && (/^\w+=/.test(tokens[i]) || COMMAND_PREFIX.test(tokens[i]))) i++;
    if (i >= tokens.length) continue;
    if (!DUMP_HEAD.test(tokens[i].replace(/^.*[/\\]/, ""))) continue;
    for (const operand of fileOperands(tokens.slice(i).join(" "))) {
      for (const path3 of candidatePaths(operand, cwd)) {
        const size = fileSize(path3);
        if (size >= threshold && !isBinaryPath(path3) && !isMachineOwned(path3)) {
          return { path: operand, size };
        }
      }
    }
  }
  return null;
}
function largeOperand(command, cwd) {
  const threshold = largeFileBytes();
  for (const operand of fileOperands(command)) {
    for (const path3 of candidatePaths(operand, cwd)) {
      const size = fileSize(path3);
      if (size >= threshold && !isBinaryPath(path3) && !isMachineOwned(path3)) {
        return { path: operand, size };
      }
    }
  }
  return null;
}
var TOOL_ALIASES = new Map(
  Object.entries({
    read: "Read",
    read_file: "Read",
    view_file: "Read",
    readfile: "Read",
    view: "Read",
    str_replace_editor_view: "Read",
    open_file: "Read",
    grep: "Grep",
    search_file_content: "Grep",
    grep_search: "Grep",
    ripgrep_search: "Grep",
    codebase_search: "Grep",
    search: "Grep",
    glob: "Glob",
    find_files: "Glob",
    file_search: "Glob",
    list_dir: "Glob",
    glob_file_search: "Glob",
    edit: "Edit",
    edit_file: "Edit",
    replace: "Edit",
    apply_patch: "Edit",
    str_replace: "Edit",
    multiedit: "Edit",
    search_replace: "Edit",
    write: "Write",
    write_file: "Write",
    create_file: "Write",
    bash: "Bash",
    powershell: "Bash",
    pwsh: "Bash",
    shell: "Bash",
    run_command: "Bash",
    execute_command: "Bash",
    run_shell_command: "Bash",
    run_terminal_cmd: "Bash",
    terminal: "Bash"
  })
);
function normalizeTool(name) {
  if (!name) return null;
  if (["Read", "Grep", "Glob", "Edit", "MultiEdit", "Write", "Bash"].includes(String(name))) {
    return String(name);
  }
  return TOOL_ALIASES.get(String(name).toLowerCase()) || null;
}
function normalizePayload(raw) {
  const rawInput = raw.tool_input ?? raw.toolInput ?? raw.tool_args ?? raw.toolArgs ?? raw.arguments ?? raw.args ?? raw.parameters ?? {};
  let input = rawInput;
  if (typeof rawInput === "string") {
    try {
      input = JSON.parse(rawInput);
    } catch {
      input = {};
    }
  }
  const filePath = input.file_path ?? input.path ?? input.absolute_path ?? input.filePath ?? input.target_file;
  const command = input.command ?? input.cmd ?? input.script;
  const cwd = raw.cwd ?? raw.workspace_root ?? process.cwd();
  return {
    session_id: String(raw.session_id ?? raw.sessionId ?? raw.conversation_id ?? "default"),
    transcript_path: raw.transcript_path ?? raw.transcriptPath ?? null,
    cwd,
    tool_name: normalizeTool(raw.tool_name ?? raw.toolName ?? raw.tool),
    tool_input: {
      ...input,
      ...filePath !== void 0 ? { file_path: canonicalPath(filePath, cwd) } : {},
      ...filePath !== void 0 ? { raw_file_path: filePath } : {},
      ...command !== void 0 ? { command: String(command) } : {},
      ...input.start_line !== void 0 ? { offset: input.start_line } : {},
      ...input.end_line !== void 0 ? { limit: input.end_line } : {}
    }
  };
}
function matchingRule(cwd, path3) {
  const canonical2 = canonicalPath(path3);
  for (const rule of activeRules(wikiDir(cwd))) {
    if (rule.type !== "skip" && rule.type !== "skeleton-only") continue;
    if (rule.anchor && rule.anchor === canonical2) return rule;
  }
  return null;
}
function replacementAvailable(availableTools, name) {
  if (availableTools === void 0) return true;
  return availableTools instanceof Set ? availableTools.has(name) : availableTools.includes(name);
}
function decide(payload, state, availableTools) {
  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  const threshold = largeFileBytes();
  if (tool === "Read") {
    const path3 = input.file_path;
    const shown = input.raw_file_path ?? path3;
    if (!path3 || isBinaryPath(path3) || isMachineOwned(path3)) return null;
    if (input.offset != null || input.limit != null) return null;
    const size = fileSize(path3);
    if (size < 0) return null;
    if (size < refusalFloorBytes()) return null;
    const rule = matchingRule(payload.cwd, path3);
    if (rule && replacementAvailable(availableTools, "smart_read")) {
      return {
        key: `read:${path3}`,
        reason: `${shown} is covered by a fix applied on ${new Date(rule.appliedAt).toISOString().slice(0, 10)}: ${rule.why}. Call smart_read with path="${shown}" for its structure, or revert the rule with id "${rule.id}" if it is wrong.`
      };
    }
    if (state.seen[path3] && replacementAvailable(availableTools, "smart_read")) {
      return {
        key: `read:${path3}`,
        reason: `You already read ${shown} earlier in this session. Call the token-optimizer MCP tool smart_read with path="${shown}" instead -- it returns only a diff of what changed since that read, typically a few tokens rather than the whole file.`
      };
    }
    if (size >= threshold && replacementAvailable(availableTools, "smart_read")) {
      return {
        key: `read:${path3}`,
        reason: `${shown} is ${KB(size)} KB, large enough to cost a meaningful share of the context window. Call the token-optimizer MCP tool smart_read with path="${shown}" instead -- it caches the content and returns diffs on later reads.`
      };
    }
    return null;
  }
  if (tool === "Grep") {
    if (input.output_mode && input.output_mode !== "content") return null;
    if (!replacementAvailable(availableTools, "smart_grep")) return null;
    const pattern = input.pattern || "";
    return {
      key: `grep:${pattern}:${input.path || ""}`,
      reason: `Call the token-optimizer MCP tool smart_grep instead of the built-in Grep (pattern="${pattern}"). It returns deduplicated, context-trimmed matches rather than every raw hit.`
    };
  }
  if (tool === "Glob") {
    if (!replacementAvailable(availableTools, "smart_glob")) return null;
    const pattern = input.pattern || "";
    return {
      key: `glob:${pattern}`,
      reason: `Call the token-optimizer MCP tool smart_glob instead of the built-in Glob (pattern="${pattern}"). It returns filtered, paginated paths rather than an unbounded match list.`
    };
  }
  if (tool === "Edit" || tool === "MultiEdit") {
    if (!replacementAvailable(availableTools, "smart_edit")) return null;
    const path3 = input.file_path;
    if (!path3) return null;
    const size = fileSize(path3);
    if (size < threshold) return null;
    return {
      key: `edit:${path3}`,
      reason: `${path3} is ${KB(size)} KB. Call the token-optimizer MCP tool smart_edit with path="${path3}" instead -- it applies the change and returns a compact unified diff rather than echoing the file.`
    };
  }
  if (tool === "Write") {
    if (!replacementAvailable(availableTools, "smart_write")) return null;
    const path3 = input.file_path;
    const content = input.content || "";
    if (!path3 || content.length < threshold) return null;
    return {
      key: `write:${path3}`,
      reason: `You are writing ${KB(content.length)} KB to ${path3}. Call the token-optimizer MCP tool smart_write instead -- it stores the content through the cache so later reads of this file diff against it.`
    };
  }
  if (tool === "Bash") {
    const command = input.command || "";
    {
      const hit = largeDumpedOperand(command, payload.cwd);
      if (hit && replacementAvailable(availableTools, "smart_read")) {
        return {
          key: `bash:${hit.path}`,
          reason: `This command prints ${hit.path} (${KB(hit.size)} KB) into the context. Call the token-optimizer MCP tool smart_read with path="${hit.path}" instead -- same content, cached and diffed.`
        };
      }
    }
    if (isRecursiveSearch(command) && replacementAvailable(availableTools, "smart_grep")) {
      if (!largeOperand(command, payload.cwd)) {
        return {
          key: `bash:search:${command.slice(0, 80)}`,
          reason: `Recursive shell searches return unbounded output. Call the token-optimizer MCP tool smart_grep instead -- it caps and deduplicates results before they reach the context window.`
        };
      }
    }
  }
  return null;
}
function remember(payload, state) {
  const path3 = payload.tool_input?.file_path;
  if (path3 && payload.tool_name === "Read") {
    state.seen[path3] = true;
  }
}
function readCostBytes(payload) {
  if (payload.tool_name !== "Read") return 0;
  const path3 = payload.tool_input?.file_path;
  if (!path3 || isBinaryPath(path3)) return 0;
  const size = fileSize(path3);
  return size > 0 ? size : 0;
}

// src/optimizer/hooks/lib/metrics.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync3, chmodSync as chmodSync2, statSync as statSync4, existsSync as existsSync2, readFileSync as readFileSync4 } from "node:fs";
import { join as join5 } from "node:path";
import { randomBytes } from "node:crypto";
var metricsPath = (dir) => join5(dir, "metrics.jsonl");
function fingerprint(path3) {
  try {
    const st = statSync4(path3);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return null;
  }
}
var idCounter = 0;
function nextId() {
  idCounter += 1;
  return `${idCounter.toString(36)}-${randomBytes(4).toString("hex")}`;
}
function record(dir, event) {
  try {
    mkdirSync3(dir, { recursive: true, mode: 448 });
    try {
      chmodSync2(dir, 448);
    } catch {
    }
    const id = event.id || nextId();
    const complete = {
      schemaVersion: event.schemaVersion || 2,
      id,
      ...event,
      at: event.at ?? Date.now()
    };
    appendFileSync2(metricsPath(dir), `${JSON.stringify(complete)}
`);
    return complete;
  } catch {
    return null;
  }
}
function recordRead(dir, { anchor, sessionId, bytes, fp = null }) {
  if (!anchor || !bytes) return;
  record(dir, { kind: "read", anchor, sessionId, tokens: Math.ceil(bytes / 4), fp });
}
var MAX_BYTES = Number(process.env.TOKEN_OPTIMIZER_METRICS_BYTES) || 2e6;

// src/optimizer/hooks/lib/surface.ts
function maybeSurface(_dir, options = {}) {
  return { text: null, state: options.state?.forecast ?? null };
}

// src/optimizer/hooks/lib/recording.ts
import { readFileSync as readFileSync5, existsSync as existsSync3 } from "node:fs";
import { join as join6 } from "node:path";
var NUDGE_AFTER_EDITS = Number(process.env.TOKEN_OPTIMIZER_NUDGE_AFTER) || 8;
var SUBSTANTIVE = /* @__PURE__ */ new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
function isSubstantive(toolName) {
  return SUBSTANTIVE.has(String(toolName || ""));
}
function findingCount(dir) {
  const path3 = join6(dir, "graph.jsonl");
  if (!existsSync3(path3)) return 0;
  let text;
  try {
    text = readFileSync5(path3, "utf8");
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
function recordingNudge(dir, { state = {}, edits = 0, files = [] } = {}) {
  if (state.recordingNudged) return null;
  if (edits < NUDGE_AFTER_EDITS) return null;
  if (findingCount(dir) > 0) return null;
  const named = [...new Set(files)].slice(0, 3);
  const subject = named.length ? named.map((f) => f.split(/[\\/]/).pop()).join(", ") : "this project";
  return `You have made ${edits} edits this session (${subject}) and this project's graph holds no findings at all -- so the next session starts from nothing and re-derives whatever you have worked out. Call wiki_write for anything durable you concluded: a dead end and why, a decision and what you rejected, a command that finally worked. Anchor it to the file it is about. Not worth recording: what the code plainly says.`;
}

// src/optimizer/hooks/lib/inject.ts
function forTouch(_dir, _graph, _rawPath, _options = {}) {
  return null;
}
function forCommand(_dir, _graph, _command, _options = {}) {
  return null;
}
function forSharedCommand(_projectDir, _command, _options = {}) {
  return null;
}
function noteActClasses(_state, _command) {
  return /* @__PURE__ */ new Set();
}
function forRepeatedAct(_projectDir, _command, _crossedClasses, _options = {}) {
  return null;
}
function refusalPayload(_graph, _rawPath, _options = {}) {
  return null;
}
function substitutionFor(_dir, _graph, _rawPath, _source, _options = {}) {
  return null;
}

// src/optimizer/hooks/lib/staleness.ts
function indexFile(_dir, _path, _source) {
}

// src/optimizer/hooks/lib/transcript.ts
function isArchived(path3) {
  return /[\\/]\.token-optimizer[\\/]wiki[\\/]transcripts[\\/]/.test(String(path3));
}

// src/optimizer/hooks/lib/experiment.ts
var EXPERIMENT_ARMS = ["baseline", "optimizer", "retrieval", "full"];
var FEATURES = {
  baseline: { routing: false, retrieval: false, capture: false, harvest: false },
  optimizer: { routing: true, retrieval: false, capture: false, harvest: false },
  retrieval: { routing: true, retrieval: true, capture: true, harvest: false },
  full: { routing: true, retrieval: true, capture: true, harvest: true }
};
function experimentArm(env = process.env) {
  const requested = String(env.TOKEN_OPTIMIZER_EXPERIMENT_ARM || "").trim().toLowerCase();
  return EXPERIMENT_ARMS.includes(requested) ? requested : "full";
}
function featuresForArm(arm = experimentArm()) {
  return FEATURES[arm] || FEATURES.full;
}
var first = (...values) => values.find((value) => value !== void 0 && value !== null && value !== "");
function episodeMeta({
  client,
  raw = {},
  payload = {},
  env = process.env
} = {}) {
  const sessionId = String(
    first(
      payload.session_id,
      raw.session_id,
      raw.sessionId,
      raw.conversation_id,
      raw.conversationId,
      raw.taskId,
      raw.task_id,
      raw.trajectory_id,
      "default"
    )
  );
  const episodeId = String(first(env.TOKEN_OPTIMIZER_EPISODE_ID, raw.episode_id, raw.episodeId, sessionId));
  const toolCallId = first(
    raw.tool_use_id,
    raw.toolUseId,
    raw.tool_call_id,
    raw.toolCallId,
    raw.call_id,
    raw.callId,
    raw.postToolUse?.toolUseId,
    raw.preToolUse?.toolUseId
  );
  const model = first(payload.model, raw.model?.slug, raw.model, raw.model_name, env.TOKEN_OPTIMIZER_MODEL);
  const clientVersion = first(raw.client_version, raw.clientVersion, raw.version, env.TOKEN_OPTIMIZER_CLIENT_VERSION);
  const modelVersion = first(raw.model_version, raw.modelVersion, env.TOKEN_OPTIMIZER_MODEL_VERSION);
  return {
    schemaVersion: 2,
    episodeId,
    sessionId,
    turnId: first(raw.turn_id, raw.turnId, raw.message_id, raw.messageId) ?? null,
    toolCallId: toolCallId == null ? null : String(toolCallId),
    taskId: first(env.TOKEN_OPTIMIZER_TASK_ID, raw.task_id, raw.taskId) ?? null,
    pairId: first(env.TOKEN_OPTIMIZER_PAIR_ID, raw.pair_id, raw.pairId) ?? null,
    arm: experimentArm(env),
    client: String(client || first(raw.client, raw.client_name, "unknown")),
    clientVersion: clientVersion == null ? null : String(clientVersion),
    model: model == null ? null : String(model),
    modelVersion: modelVersion == null ? null : String(modelVersion)
  };
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
function optimizerToolsForHook(_raw = {}, _state = {}, env = process.env) {
  const override = env.TOKEN_OPTIMIZER_MCP_CAPABILITIES;
  if (override !== void 0) {
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
    return { proven: true, names };
  }
  return { proven: true, names: new Set(HOOK_MCP_TOOLS) };
}
function rememberOptimizerTools(state, _evidence, _observedAt = Date.now()) {
  return state;
}

// src/optimizer/hooks/lib/ucr-guard.ts
import { appendFileSync as appendFileSync3, existsSync as existsSync4, readFileSync as readFileSync6, statSync as statSync5 } from "node:fs";
import { createHash as createHash3 } from "node:crypto";
import { join as join7, resolve } from "node:path";
var MAX_INDEX_BYTES = 1e6;
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value) {
  return createHash3("sha256").update(canonical(value)).digest("hex");
}
function indexRoot() {
  return process.env.TOKEN_OPTIMIZER_UCR_DIR ? resolve(process.env.TOKEN_OPTIMIZER_UCR_DIR) : resolve(process.cwd(), ".token-optimizer", "ucr");
}
function loadActiveUcrGuards() {
  const path3 = join7(indexRoot(), "active-guards.json");
  if (!existsSync4(path3) || statSync5(path3).size > MAX_INDEX_BYTES) return [];
  try {
    const parsed = JSON.parse(readFileSync6(path3, "utf8"));
    const { indexHash, ...body } = parsed;
    if (parsed.schemaVersion !== "ucr.active-guards/1") return [];
    if (digest(body) !== indexHash) return [];
    return Array.isArray(parsed.guards) ? parsed.guards.filter((guard) => guard?.id && guard.state === "active" && guard.scope) : [];
  } catch {
    return [];
  }
}
function valueAtPath(value, field) {
  return String(field || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}
function conditionMatches(condition, action) {
  const actual = valueAtPath(action, condition.field);
  const expected = condition.value;
  if (condition.operator === "equals") return actual === expected;
  if (condition.operator === "contains") return String(actual || "").includes(String(expected));
  if (condition.operator === "startsWith") return String(actual || "").startsWith(String(expected));
  if (condition.operator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (condition.operator === "matches") {
    try {
      return new RegExp(String(expected), condition.flags || "").test(String(actual || ""));
    } catch {
      return false;
    }
  }
  return false;
}
function scoped(guard, context) {
  for (const field of ["taskId", "projectId", "workspaceId"]) {
    if (guard.scope?.[field] && guard.scope[field] !== context[field]) return false;
  }
  return true;
}
function audit(record2) {
  try {
    appendFileSync3(join7(indexRoot(), "guard-audit.jsonl"), `${JSON.stringify(record2)}
`, {
      encoding: "utf8",
      mode: 384
    });
  } catch {
  }
}
function evaluateUcrGuards(payload, paths = []) {
  const context = {
    taskId: process.env.TOKEN_OPTIMIZER_TASK_ID || null,
    projectId: process.env.TOKEN_OPTIMIZER_PROJECT_ID || null,
    workspaceId: process.env.TOKEN_OPTIMIZER_WORKSPACE_ID || null
  };
  const candidates = [
    payload?.tool_input || {},
    ...paths.map((path3) => ({ ...payload?.tool_input || {}, path: path3 }))
  ];
  for (const guard of loadActiveUcrGuards()) {
    if (!scoped(guard, context)) continue;
    const matched = candidates.some(
      (action) => guard.triggers.every((condition) => conditionMatches(condition, action))
    );
    if (!matched) continue;
    const record2 = {
      at: Date.now(),
      guardId: guard.id,
      taskId: context.taskId,
      toolName: payload?.tool_name || null,
      actionHash: digest({ tool: payload?.tool_name, input: payload?.tool_input }),
      decision: "deny",
      executed: false
    };
    audit(record2);
    return {
      key: `ucr-guard:${guard.id}:${record2.actionHash}`,
      guardId: guard.id,
      reason: [
        "Verified prior correction blocked this repeated action before execution.",
        `Use instead: ${JSON.stringify(guard.replacementAction)}`,
        `Evidence: ${(guard.evidence || []).join(", ")}`
      ].join(" "),
      replacementAction: guard.replacementAction,
      persistent: true
    };
  }
  return null;
}

// src/optimizer/hooks/lib/observability.ts
function hookDeadlineMs(env = process.env) {
  const parsed = Number(env.TOKEN_OPTIMIZER_HOOK_DEADLINE_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4200;
}

// src/optimizer/hooks/pretooluse.ts
var HARVEST_MAX_BYTES = Number(process.env.TOKEN_OPTIMIZER_HARVEST_MAX_BYTES) || 4e6;
function verdictToHookOutput(verdict) {
  if (verdict.kind === "allow") return {};
  if (verdict.kind === "allowWithContext") return allowWithContext("PreToolUse", verdict.context);
  return deny("PreToolUse", verdict.reason);
}
function decidePreToolUse(raw) {
  if (!raw) return {};
  try {
    if (mode() === MODE_OFF) return {};
    const payload = normalizePayload(raw);
    if (!payload.tool_name) return {};
    const features = featuresForArm();
    const episode = episodeMeta({ client: "claude-code", raw });
    const agentScope = payload.transcript_path || null;
    const state = loadState(payload.session_id, agentScope);
    const toolEvidence = optimizerToolsForHook(raw, state);
    rememberOptimizerTools(state, toolEvidence);
    const ucrVerdict = evaluateUcrGuards(payload, touchedFiles(payload).map((item) => item.path));
    const verdict = ucrVerdict || (features.routing ? decide(payload, state, toolEvidence.names) : null);
    const dirFor = (path3) => wikiDir(projectRootFor(path3, payload.cwd) ?? payload.cwd);
    if (!verdict) {
      remember(payload, state);
      saveState(payload.session_id, state, agentScope);
      const touched = touchedFiles(payload);
      const bytes = readCostBytes(payload);
      if (bytes && payload.tool_input.file_path) {
        recordRead(dirFor(payload.tool_input.file_path), {
          anchor: payload.tool_input.file_path,
          sessionId: payload.session_id,
          bytes,
          fp: fingerprint(payload.tool_input.file_path)
        });
      } else if (isContentDump(payload.tool_input.command)) {
        for (const { path: path3, size } of touched) {
          if (size > 0) {
            recordRead(dirFor(path3), {
              anchor: path3,
              sessionId: payload.session_id,
              bytes: size,
              fp: fingerprint(path3)
            });
          }
        }
      }
      let context = null;
      if (features.retrieval) {
        try {
          state.injected = state.injected || [];
          const alreadyInjected = new Set(state.injected);
          const before = alreadyInjected.size;
          const parts = [];
          let actsChanged = false;
          for (const { path: path3 } of touched) {
            const dir = dirFor(path3);
            const note = forTouch(dir, load(dir), path3, {
              sessionId: payload.session_id,
              alreadyInjected,
              episode
            });
            if (note) parts.push(note);
          }
          const command = payload.tool_input?.command;
          if (command) {
            const root = commandProjectRoot(payload, payload.cwd);
            const dir = wikiDir(root ?? payload.cwd);
            const note = forCommand(dir, load(dir), command, {
              sessionId: payload.session_id,
              alreadyInjected,
              episode
            });
            if (note) parts.push(note);
            const shared = forSharedCommand(dir, command, {
              sessionId: payload.session_id,
              alreadyInjected,
              projectRoot: root,
              episode
            });
            if (shared) parts.push(shared);
            const crossed = noteActClasses(state, command);
            if (crossed !== null) actsChanged = true;
            const repeat2 = forRepeatedAct(dir, command, crossed, {
              sessionId: payload.session_id,
              projectRoot: root,
              episode
            });
            if (repeat2) parts.push(repeat2);
          }
          if (alreadyInjected.size !== before || actsChanged) {
            state.injected = [...alreadyInjected];
            saveState(payload.session_id, state, agentScope);
          }
          if (parts.length) context = parts.join("\n\n");
        } catch {
        }
      }
      try {
        if (features.harvest && toolEvidence.names.has("wiki_write") && isSubstantive(payload.tool_name)) {
          state.edits = (state.edits || 0) + 1;
          const edited = payload.tool_input?.file_path;
          if (edited) state.editedFiles = [edited, ...state.editedFiles || []].slice(0, 20);
          const nudge = recordingNudge(dirFor(edited || payload.cwd || process.cwd()), {
            state,
            edits: state.edits,
            files: state.editedFiles
          });
          if (nudge) {
            state.recordingNudged = true;
            context = context ? `${context}

${nudge}` : nudge;
          }
          saveState(payload.session_id, state, agentScope);
        }
      } catch {
      }
      try {
        const surfaced = maybeSurface(dirFor(payload.cwd || process.cwd()), {
          state
        });
        if (surfaced.state !== state.forecast) {
          state.forecast = surfaced.state;
          saveState(payload.session_id, state, agentScope);
        }
        if (surfaced.text) context = context ? `${context}

${surfaced.text}` : surfaced.text;
      } catch {
      }
      if (features.capture) {
        for (const { path: path3, size } of touched) {
          try {
            if (isArchived(path3)) continue;
            if (size > HARVEST_MAX_BYTES) continue;
            const dir = dirFor(path3);
            if (!isFsSafePath(path3)) continue;
            const source = readFileSync7(path3, "utf8");
            harvest(dir, {
              filePath: path3,
              sessionId: payload.session_id,
              action: payload.tool_name ?? void 0,
              hash: contentHash(path3, source)
            });
            indexFile(dir, path3, source);
          } catch {
          }
        }
      }
      return context ? allowWithContext("PreToolUse", context) : {};
    }
    const repeat = verdict.persistent ? false : alreadyDenied(state, verdict.key);
    const seenThisSession = Boolean(state.seen?.[payload.tool_input?.file_path ?? ""]);
    remember(payload, state);
    saveState(payload.session_id, state, agentScope);
    let reason = verdict.reason;
    if (!repeat && payload.tool_name === "Read" && payload.tool_input.file_path) {
      try {
        const filePath = payload.tool_input.file_path;
        const dir = wikiDir(projectRootFor(filePath, payload.cwd) ?? payload.cwd);
        const graph = load(dir, { snapshots: true });
        const carried = refusalPayload(graph, filePath, { seenThisSession });
        if (carried) {
          reason = carried;
        } else {
          const source = readFileSync7(filePath, "utf8");
          indexFile(dir, filePath, source);
          const substitution = substitutionFor(
            dir,
            load(dir),
            payload.tool_input.raw_file_path ?? filePath,
            source,
            {
              sessionId: payload.session_id,
              client: episode.client,
              clientVersion: episode.clientVersion,
              model: episode.model,
              modelVersion: episode.modelVersion
            }
          );
          if (substitution) reason = substitution;
        }
      } catch {
      }
    }
    return verdictToHookOutput(enforceVerdict(reason, repeat));
  } catch {
    return {};
  }
}
async function runPreToolUse(readInput) {
  const raw = await readInput();
  return decidePreToolUse(raw);
}
async function main() {
  const deadline = new Promise((resolve2) => {
    setTimeout(() => resolve2({}), hookDeadlineMs()).unref?.();
  });
  const output = await Promise.race([
    runPreToolUse(() => readHookInput()),
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
  decidePreToolUse,
  allow as hookAllow,
  runPreToolUse
};
//# sourceMappingURL=pretooluse-optimizer.mjs.map
