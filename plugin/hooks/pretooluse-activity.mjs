// src/handoff/activity-hook.ts
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

// src/handoff/activity.ts
import { mkdirSync, writeFileSync } from "node:fs";
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

// src/handoff/activity.ts
function writeActivityBeacon(record, options = {}) {
  try {
    const home = options.home ?? getOptiflowHome();
    mkdirSync(home, { recursive: true });
    const file = path2.join(home, "activity.json");
    writeFileSync(file, JSON.stringify(record), "utf8");
  } catch {
  }
}

// src/handoff/activity-hook.ts
async function runActivityHook(readInput, options = {}) {
  const input = await readInput();
  const tool = input?.tool_name;
  if (typeof tool === "string" && tool.length > 0) {
    writeActivityBeacon({ tool, timestamp: options.now ?? Date.now() }, { home: options.home });
  }
  return {};
}
async function main() {
  const output = await runActivityHook(() => readHookInput());
  writeHookOutput(output);
}
var entryArg = process.argv[1];
var isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;
if (isDirectRun) {
  main();
}
export {
  runActivityHook
};
//# sourceMappingURL=pretooluse-activity.mjs.map
