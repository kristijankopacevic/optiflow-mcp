// Shared policy for the optimizer's PreToolUse/PreCompact enforcement hooks.
//
// Faithfully ported from `vendor/token-optimizer-mcp/plugin/hooks/lib/policy.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md), with ONE structural change:
// vendor's `allow()`/`deny()`/`advise()`/`enforce()` call `process.exit()`
// directly and write to `process.stdout` themselves. This repo's hook
// convention (`src/chop/pretooluse.ts`, `src/handoff/precompact-hook.ts`) is
// a pure decision function plus a thin stdin/stdout wrapper, so `enforce()`
// below returns a `Verdict` object instead of exiting — the hook entry point
// (`../pretooluse.ts`) is what turns that into `HookOutput` via
// `src/core/hook-io.ts`. Every other behavior (fail-open safety properties,
// loop-breaking, the env-var escape hatch, session state locking/merging) is
// unchanged.
//
// FOUR SAFETY PROPERTIES, none optional (ported verbatim from vendor's own
// module header, because they are the actual point of this file):
//   1. FAIL OPEN — any unexpected condition allows the original call.
//   2. LOOP BREAKING — a denial is only ever issued once per target; a
//      second attempt at the same thing is allowed through.
//   3. AN ESCAPE HATCH THAT IS ONE VARIABLE — TOKEN_OPTIMIZER_MODE=off
//      disables everything; =advise restores non-blocking behaviour.
//   4. NO BLOCKING OF CHEAP CALLS — small files, paged reads, and searches
//      that already read from a pipe are left alone.
//
// PATH CONVENTION NOTE: this file's session state is EPHEMERAL, per-process
// scratch state (which files this session has already seen/denied this
// turn), scoped under `TOKEN_OPTIMIZER_STATE_DIR` or `os.tmpdir()` — exactly
// as vendor ships it. This is deliberately NOT routed through
// `src/optimizer/paths.ts`'s `getOptimizerHome()` convention: it was never
// one of the ~8 hardcoded `~/.token-optimizer*` paths Phase 5 reconciled
// (`src/handoff/checkpoint.ts`'s `resolveTokenOptimizerStateRef` confirms
// this scratch root is a *different* concern from the MCP server's own
// durable `sessions.json.gz`, and was "confirmed absent on this machine"
// when handoff was built — i.e. nothing else in this codebase depends on
// this path today). Keeping vendor's own env var name/default here avoids
// inventing a second convention for something genuinely ephemeral.

import {
  statSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { isFsSafePath } from "./paths.js";

/** Enforcement modes, least to most permissive. */
export const MODE_ENFORCE = "enforce" as const;
export const MODE_ADVISE = "advise" as const;
export const MODE_OFF = "off" as const;
export type Mode = typeof MODE_ENFORCE | typeof MODE_ADVISE | typeof MODE_OFF;

/**
 * Reads the mode. Enforcement is the DEFAULT — an unrecognised value falls
 * back to enforce rather than silently disabling, so a typo cannot quietly
 * turn the product off.
 */
export function mode(env: NodeJS.ProcessEnv = process.env): Mode {
  const raw = (env.TOKEN_OPTIMIZER_MODE || "").trim().toLowerCase();
  if (raw === MODE_OFF) return MODE_OFF;
  if (raw === MODE_ADVISE) return MODE_ADVISE;
  return MODE_ENFORCE;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Size at which a built-in read stops being cheap (~6-8k tokens). */
export function largeFileBytes(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv(env, "TOKEN_OPTIMIZER_LARGE_READ_BYTES", 25_600);
}

/**
 * Size below which NO refusal can pay for itself — the refusal message
 * itself costs 50-110 tokens, so refusing anything smaller spends more than
 * it saves.
 */
export function refusalFloorBytes(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv(env, "TOKEN_OPTIMIZER_REFUSAL_FLOOR_BYTES", 1_024);
}

/**
 * Whether to refuse an unranged re-read of a file that is byte-identical to
 * what the session already read. On by default.
 *
 * Env-var-gated rather than `optiflow.config.json`-gated on purpose: this is
 * the vendored enforcement layer, and every other threshold it exposes
 * (`largeFileBytes`, `refusalFloorBytes`, `mode`) is an env var. Adding one
 * config-file knob here would mean two places to look for the same class of
 * setting.
 */
export function repeatedReadSuppressionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TOKEN_OPTIMIZER_SUPPRESS_REPEAT_READS !== "0";
}

/**
 * How long a recorded read keeps licensing suppression.
 *
 * The rule's premise is "you already have this content in front of you".
 * Compaction is handled exactly (`clearSeen` wipes `seen` on `PreCompact`),
 * but a very long uncompacted session can still push an early read far
 * enough back that re-reading is reasonable. This window is the hedge
 * against that premise quietly going stale; `0` disables the window.
 */
export function repeatedReadWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv(env, "TOKEN_OPTIMIZER_REPEAT_READ_WINDOW_MINUTES", 30) * 60_000;
}

/** Extensions whose bytes are not tokens, so byte thresholds do not apply. */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg", ".pdf",
  ".zip", ".gz", ".tar", ".7z", ".rar", ".exe", ".dll", ".so", ".dylib",
  ".bin", ".wasm", ".mp3", ".mp4", ".wav", ".mov", ".woff", ".woff2",
  ".ttf", ".eot",
]);

export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/** Directories owned by a machine rather than by a person. */
const MACHINE_OWNED =
  /(?:^|[/\\])(?:\.git|\.hg|\.svn|node_modules|\.venv|__pycache__|\.next|\.turbo|dist|obj|bin)(?:[/\\]|$)/i;

/** Collapses `.`/`..` textually, without touching the filesystem. */
function normalizeSegments(p: string): string {
  const drive = /^[a-z]:/i.test(p) ? p.slice(0, 2) : "";
  const rest = drive ? p.slice(2) : p;
  const rooted = rest.startsWith("/");

  const out: string[] = [];
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

/** Whether a path lives inside — or IS — something the user never authored. */
export function isMachineOwned(path: unknown): boolean {
  return MACHINE_OWNED.test(
    normalizeSegments(String(path || "").split("\\").join("/"))
  );
}

/** Size in bytes, or -1 when the path is missing or is not a regular file. */
export function fileSize(path: unknown): number {
  if (!isFsSafePath(path)) return -1;
  try {
    const st = statSync(path as string);
    return st.isFile() ? st.size : -1;
  } catch {
    return -1;
  }
}

/* ------------------------------------------------------------------ *
 * Session state
 * ------------------------------------------------------------------ */

/**
 * What the session knows about one file it has already read.
 *
 * Was a bare `true`. Carrying the content hash is what lets the router tell
 * "you read this and it hasn't changed" (the model still holds the content,
 * so a re-read buys nothing) apart from "you read this and it has since
 * changed" (a re-read is legitimate, and `smart_read` can diff it).
 *
 * `hash` is `""` when unknown — either the file could not be hashed, or the
 * entry was migrated from a state file written before this field existed
 * (see `normalizeSeen`). An unknown hash never licenses suppression; it
 * degrades to exactly the redirect behaviour that shipped before.
 */
export interface SeenEntry {
  hash: string;
  /** Epoch ms of the read that recorded this. `0` for migrated entries. */
  at: number;
}

export interface SessionState {
  seen: Record<string, SeenEntry>;
  denied: Record<string, boolean>;
  injected: string[];
  actCounts: Record<string, number>;
  forecast: { checkedAt: number; shown?: number } | null;
  edits: number;
  editedFiles: string[];
  harvestedEdits: number;
  recordingNudged: boolean;
  optimizerTools: string[];
  optimizerToolsObservedAt: number;
}

const stateRoot = (env: NodeJS.ProcessEnv = process.env): string =>
  env.TOKEN_OPTIMIZER_STATE_DIR || join(tmpdir(), "token-optimizer-hooks");

/**
 * Per SESSION and per AGENT. Every subagent inherits its parent's session
 * id, so keying on the session alone gives all of them ONE `seen` set and a
 * sibling's read silences another's. `agent` (the caller's transcript path)
 * is hashed rather than sanitised into the filename: it's an absolute path,
 * so stripping separators would collide across directories.
 */
function statePath(sessionId: unknown, agent?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9_-]/g, "");
  const scope = agent
    ? `-${createHash("sha256").update(String(agent)).digest("hex").slice(0, 12)}`
    : "";
  return join(stateRoot(env), `${safe || "default"}${scope}.json`);
}

function emptyState(): SessionState {
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
    optimizerToolsObservedAt: 0,
  };
}

/**
 * Coerces a `seen` map from disk into the current `SeenEntry` shape.
 *
 * MIGRATION, not just validation: `seen` used to be
 * `Record<string, boolean>`, and a state file written by the previous
 * version is sitting in the temp dir of every session that is currently
 * running when this ships. A legacy `true` becomes `{ hash: "", at: 0 }` —
 * still "seen", but with no hash, so it can never license the new
 * suppression rule and behaves exactly as it did before. Anything
 * unrecognisable is dropped rather than carried forward, matching how the
 * rest of `loadState` treats a shape it does not understand.
 */
export function normalizeSeen(raw: unknown): Record<string, SeenEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SeenEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true) {
      out[key] = { hash: "", at: 0 };
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entry = value as { hash?: unknown; at?: unknown };
      out[key] = {
        hash: typeof entry.hash === "string" ? entry.hash : "",
        at: Number.isFinite(entry.at) ? Number(entry.at) : 0,
      };
    }
  }
  return out;
}

/**
 * Loads session state, validating its SHAPE and not merely that it parsed —
 * a file containing `null`, `{}`, or an older layout must not throw on the
 * next property access inside the router (which would silently disable
 * enforcement for the rest of the session).
 */
export function loadState(
  sessionId: unknown,
  agent?: string | null,
  env: NodeJS.ProcessEnv = process.env
): SessionState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId, agent, env), "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyState();
    return {
      seen: normalizeSeen(parsed.seen),
      denied: parsed.denied && typeof parsed.denied === "object" ? parsed.denied : {},
      injected: Array.isArray(parsed.injected) ? parsed.injected : [],
      actCounts:
        parsed.actCounts && typeof parsed.actCounts === "object" && !Array.isArray(parsed.actCounts)
          ? parsed.actCounts
          : {},
      forecast:
        parsed.forecast &&
        typeof parsed.forecast === "object" &&
        !Array.isArray(parsed.forecast) &&
        Number.isFinite(parsed.forecast.checkedAt)
          ? parsed.forecast
          : null,
      edits: Number.isFinite(parsed.edits) ? parsed.edits : 0,
      editedFiles: Array.isArray(parsed.editedFiles) ? parsed.editedFiles : [],
      harvestedEdits: Number.isFinite(parsed.harvestedEdits) ? parsed.harvestedEdits : 0,
      recordingNudged: parsed.recordingNudged === true,
      optimizerTools: Array.isArray(parsed.optimizerTools)
        ? parsed.optimizerTools.filter((name: unknown) => typeof name === "string")
        : [],
      optimizerToolsObservedAt: Number.isFinite(parsed.optimizerToolsObservedAt)
        ? parsed.optimizerToolsObservedAt
        : 0,
    };
  } catch {
    return emptyState();
  }
}

/** Sleeps synchronously — these hooks are single-shot and must reach a decision before returning. */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer unavailable under some policies; caller retries sooner.
  }
}

/** Best-effort exclusive lock. Returns the lock path, or null if not acquired. */
function takeLock(
  sessionId: unknown,
  agent: string | null | undefined,
  env: NodeJS.ProcessEnv,
  { attempts = 20, staleMs = 5000, waitMs = 15 } = {}
): string | null {
  const path = `${statePath(sessionId, agent, env)}.lock`;
  for (let i = 0; i < attempts; i++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      closeSync(fd);
      return path;
    } catch {
      try {
        if (Date.now() - statSync(path).mtimeMs > staleMs) {
          unlinkSync(path);
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

/**
 * Persists session state, merging (never overwriting) rather than
 * last-writer-wins — parallel tool calls each spawn their own hook process,
 * and losing a `denied` entry re-arms a refusal that was already issued.
 */
export function saveState(
  sessionId: unknown,
  state: SessionState,
  agent?: string | null,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  let lock: string | null = null;
  try {
    mkdirSync(stateRoot(env), { recursive: true, mode: 0o700 });

    lock = takeLock(sessionId, agent, env);
    if (!lock) return false;

    const current = loadState(sessionId, agent, env);
    const merged: SessionState = {
      seen: { ...current.seen, ...state.seen },
      denied: { ...current.denied, ...state.denied },
      injected: [...new Set([...(current.injected || []), ...(state.injected || [])])],
      actCounts: (() => {
        const out: Record<string, number> = { ...(current.actCounts || {}) };
        for (const [k, v] of Object.entries(state.actCounts || {})) {
          out[k] = Math.max(Number(out[k]) || 0, Number(v) || 0);
        }
        return out;
      })(),
      edits: Math.max(Number(current.edits) || 0, Number(state.edits) || 0),
      editedFiles: [...new Set([...(state.editedFiles || []), ...(current.editedFiles || [])])].slice(0, 20),
      harvestedEdits: Math.max(Number(current.harvestedEdits) || 0, Number(state.harvestedEdits) || 0),
      recordingNudged: Boolean(current.recordingNudged || state.recordingNudged),
      ...(() => {
        const mineAt = Number(state.optimizerToolsObservedAt) || 0;
        const theirsAt = Number(current.optimizerToolsObservedAt) || 0;
        const mineWins = mineAt >= theirsAt && mineAt > 0;
        return {
          optimizerTools: mineWins ? [...(state.optimizerTools || [])] : [...(current.optimizerTools || [])],
          optimizerToolsObservedAt: mineWins ? mineAt : theirsAt,
        };
      })(),
      forecast: (() => {
        const mine = state.forecast || null;
        const theirs = current.forecast || null;
        const stamp = (f: SessionState["forecast"]) => (Number.isFinite(f?.checkedAt) ? f!.checkedAt : null);
        if (stamp(mine) === null) return theirs;
        if (stamp(theirs) === null) return mine;
        return stamp(mine)! >= stamp(theirs)! ? mine : theirs;
      })(),
    };

    const target = statePath(sessionId, agent, env);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(merged), { mode: 0o600 });
    renameSync(temporary, target);
    return true;
  } catch {
    return false;
  } finally {
    if (lock) {
      try {
        unlinkSync(lock);
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Forgets which files the session has read, keeping the rest of its state.
 * Separate from `saveState` because that merges (never shrinks) `seen`.
 * The one caller is the PreCompact hook: compaction is exactly the event
 * that empties the reader's context, so `seen` (which licenses "unchanged
 * since you last read it") must be cleared here.
 */
export function clearSeen(sessionId: unknown, agent?: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  let lock: string | null = null;
  try {
    mkdirSync(stateRoot(env), { recursive: true, mode: 0o700 });
    lock = takeLock(sessionId, agent, env);
    if (!lock) return false;

    const current = loadState(sessionId, agent, env);
    const cleared: SessionState = { ...current, seen: {} };

    const target = statePath(sessionId, agent, env);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(cleared), { mode: 0o600 });
    renameSync(temporary, target);
    return true;
  } catch {
    return false;
  } finally {
    if (lock) {
      try {
        unlinkSync(lock);
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Records that a target was denied, and reports whether this is a REPEAT.
 * The caller must allow any repeat through — this single rule bounds the
 * cost of every failure mode: a model loses at most one turn per target.
 */
export function alreadyDenied(state: SessionState, key: string): boolean {
  const seen = Boolean(state.denied[key]);
  state.denied[key] = true;
  return seen;
}

/* ------------------------------------------------------------------ *
 * Hook verdicts — the pure equivalent of vendor's allow()/deny()/advise()
 * ------------------------------------------------------------------ */

export type Verdict =
  | { kind: "allow" }
  | { kind: "allowWithContext"; context: string }
  | { kind: "deny"; reason: string }
  // Deny, but hand the model the compressed content it would otherwise
  // need a second `smart_read` round trip to get (Phase 2 of the plan:
  // "deny-and-substitute"). `substitute` rides in `additionalContext`
  // alongside the denial — see `../../../core/hook-io.ts`'s
  // `denyWithSubstitute()`, the only place that turns this into a
  // `HookOutput`.
  | { kind: "denyWithSubstitute"; reason: string; substitute: string };

/**
 * The off switch, carried by the thing doing the blocking. Appended once —
 * a reason that already names it (a remedy rule that says so) is left as is.
 */
export function withEscape(reason: string): string {
  const text = String(reason || "");
  if (text.includes("TOKEN_OPTIMIZER_MODE")) return text;
  return `${text} (Not what you wanted? TOKEN_OPTIMIZER_MODE=off disables enforcement.)`;
}

/**
 * Applies the configured mode to a decision, returning a `Verdict` instead
 * of exiting the process (see module header). Every call site should route
 * through here so `advise` mode is guaranteed non-blocking everywhere.
 * `deniedBefore` collapses to an advisory for the same reason.
 *
 * `substitute`, if given, is the compressed content computed for a
 * `denyWithSubstitute` verdict. It degrades EXACTLY like a plain `deny`
 * does: `off` still allows outright, and `advise`/a repeat still collapses
 * to a non-blocking `allowWithContext` carrying `reason` — the tool call is
 * going through either way, so the model will get the real file and has no
 * use for a compressed stand-in. Only the true enforce-and-block case emits
 * the substitute.
 */
export function enforceVerdict(
  reason: string,
  deniedBefore: boolean,
  currentMode: Mode = mode(),
  substitute?: string
): Verdict {
  if (currentMode === MODE_OFF) return { kind: "allow" };
  if (currentMode === MODE_ADVISE || deniedBefore) {
    return { kind: "allowWithContext", context: reason };
  }
  if (substitute) return { kind: "denyWithSubstitute", reason: withEscape(reason), substitute };
  return { kind: "deny", reason: withEscape(reason) };
}
