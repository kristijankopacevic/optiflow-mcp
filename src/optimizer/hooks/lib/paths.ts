// Path identity for the optimizer's PreToolUse/PreCompact enforcement hooks.
//
// Faithfully ported from `vendor/token-optimizer-mcp/plugin/hooks/lib/paths.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md). This is genuinely core: every
// consumer in this hook tree (the `seen` re-read map, the deny-loop-breaking
// key, the wiki graph's node identity, staleness indexing) keys off the same
// canonical spelling of a path, so a bug here fragments identity everywhere
// downstream. Behavior is unchanged from vendor; only the syntax is TS.
//
// Deliberately depends on nothing but `node:path` — no zod/commander/other
// heavy imports — matching this module's vendor precedent of sitting on the
// PreToolUse hot path for every single tool call.

import { isAbsolute } from "node:path";

/** `/c/Users/x` -> `C:/Users/x`. Git Bash and MSYS write paths this way. */
const MSYS = /^\/([A-Za-z])\/(.*)$/;

/**
 * Canonicalises a path for both identity and filesystem use, in one pass.
 * Forward slashes and an upper-case drive letter, absolute where possible.
 * Case is otherwise PRESERVED — Windows is case-insensitive but its
 * filesystems are case-preserving, and lower-casing whole paths would make
 * every graph key unreadable for a property nothing here depends on.
 */
function normaliseOnce(input: unknown, cwd?: string): string {
  if (typeof input !== "string" || !input) return input as string;

  let path = input.trim();
  if (!path) return input;

  // Strip surrounding quotes a shell command may carry. Length >= 2, because
  // `startsWith`/`endsWith` both match the SAME character on a
  // one-character string: a lone `"` looked like a quoted empty path.
  if (
    path.length >= 2 &&
    ((path.startsWith('"') && path.endsWith('"')) ||
      (path.startsWith("'") && path.endsWith("'")))
  ) {
    path = path.slice(1, -1);
  }

  path = path.replace(/\\/g, "/");

  // Resolve relatives against the session's cwd so `src/a.ts` and the
  // absolute form of the same file share one identity. Joined by hand rather
  // than through `path.resolve`, which is platform-specific: on a POSIX host
  // it does not recognise `C:/Users/me/repo` as absolute. The segment loop
  // below already collapses `.`/`..`, so a plain join is enough and is the
  // same on every host.
  if (!isAbsolute(path) && !/^[A-Za-z]:/.test(path)) {
    if (cwd) {
      const base = canonicalPath(cwd);
      path = `${base.endsWith("/") ? base.slice(0, -1) : base}/${path}`;
    }
  }

  // Collapse `.`/`..` and doubled separators, without touching a UNC prefix,
  // which needs its leading pair.
  const unc = path.startsWith("//");
  path = (unc ? path.slice(2) : path).replace(/\/{2,}/g, "/");

  const segments: string[] = [];
  for (const segment of path.split("/")) {
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
  path = (unc ? "//" : "") + segments.join("/");

  // Root survives the collapse: `/` splits to ['', ''], the loop keeps only
  // the leading '' that marks absoluteness, and joining a single empty
  // segment yields '' — so the root directory would canonicalise to the
  // empty string, with no way back on a second pass.
  if (path === "" && segments.length === 1 && segments[0] === "") path = "/";

  // Trimmed on the way out as well as in: collapsing segments can RE-EXPOSE
  // whitespace (`a /` -> single segment `a ` -> joins back to `a `), which
  // the next call would trim differently, giving the same file two
  // identities depending on how many times it had been canonicalised.
  path = path.trim();

  // MSYS translation AFTER the collapse, not before — running it first made
  // this non-idempotent (`/./c/Users/me/x` isn't MSYS-shaped until the `.` is
  // dropped by a first pass, at which point a second pass reinterprets it).
  const msys = MSYS.exec(path);
  if (msys) path = `${msys[1].toUpperCase()}:/${msys[2]}`;

  // Upper-case a drive letter however it arrived, so `c:/x` and `C:/x` agree.
  path = path.replace(/^([A-Za-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);

  // A trailing separator is not part of a file's identity.
  if (path.length > 3 && path.endsWith("/")) path = path.slice(0, -1);

  return path;
}

/**
 * True unless handing this path to the filesystem would ABORT the process.
 *
 * U+10FFFF is the largest legal Unicode code point, and libuv asserts
 * `code_point < 0x10FFFF` (strictly less than) converting a UTF-8 path to
 * UTF-16 on Windows — so `existsSync`/`statSync`/`readFileSync` all kill the
 * process rather than throwing on it. A native abort walks straight through
 * any try/catch, so every filesystem call downstream of an externally
 * supplied path must be guarded by this FIRST, not defended after the fact.
 */
export function isFsSafePath(input: unknown): boolean {
  if (typeof input !== "string") return false;
  for (const character of input) {
    if (character.codePointAt(0) === 0x10ffff) return false;
  }
  return true;
}

/**
 * Canonicalises to a fixed point by iterating `normaliseOnce` until it stops
 * changing anything (capped at 8 passes as a backstop, not a truncation —
 * every step is non-expanding so the sequence provably converges).
 */
export function canonicalPath(input: unknown, cwd?: string): string {
  let path = normaliseOnce(input, cwd);
  for (let i = 0; i < 8; i++) {
    const next = normaliseOnce(path, cwd);
    if (next === path) return path;
    path = next;
  }
  return path;
}

/**
 * Spellings to try when reading from disk, most likely first. Canonicalising
 * is right for identity but a canonical path is not always the one that
 * resolves — a POSIX host has no drive letters, and a path already correct
 * should be tried as given.
 */
export function resolvableCandidates(input: unknown, cwd?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string | undefined | null) => {
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
