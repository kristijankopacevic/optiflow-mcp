// The routing decision, as a pure function.
//
// Faithfully ported from `vendor/token-optimizer-mcp/plugin/hooks/lib/decide.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md). Deliberately free of
// process/stdin/exit codes so it stays directly unit-testable, matching this
// repo's own hook convention. Returns `null` to allow, or `{ reason, key }`
// to challenge — `key` identifies the target for loop-breaking (see
// `policy.ts`'s `alreadyDenied`), so a second attempt at the same thing gets
// through.
//
// One behavioral note vs. vendor: `matchingRule` (skip/skeleton-only rules
// from `remedy.mjs`'s `activeRules`) is ported, but `remedy.ts` in this tree
// only exposes `activeRules` — the write side (`applyRemedy`, `wasteReport`,
// etc.) is genuinely unreachable from the two hooks this tree ports and is
// not implemented here (see `remedy.ts`'s own header).

import { statSync } from "node:fs";
import { join } from "node:path";
import {
  fileSize,
  isBinaryPath,
  isMachineOwned,
  largeFileBytes,
  refusalFloorBytes,
  repeatedReadSuppressionEnabled,
  repeatedReadWindowMs,
  type SeenEntry,
} from "./policy.js";
import { hashFile } from "../../tools/shared/hash-utils.js";
import { canonicalPath, resolvableCandidates, isFsSafePath } from "./paths.js";
import { activeRules } from "./remedy.js";
import { wikiDir, projectRootFor } from "./wiki.js";

const KB = (bytes: number) => Math.round(bytes / 1024);

export interface NormalizedPayload {
  session_id: string;
  transcript_path: string | null;
  cwd: string;
  tool_name: string | null;
  tool_input: Record<string, unknown> & {
    file_path?: string;
    raw_file_path?: unknown;
    command?: string;
    offset?: unknown;
    limit?: unknown;
    content?: string;
  };
}

export interface Verdict {
  key: string;
  reason: string;
  /** Set by ucr-guard.ts for a persistent (non-loop-broken) veto. */
  persistent?: boolean;
  /**
   * Set only by the unchanged-repeated-read rule: the file size that was
   * NOT sent because the read was refused outright. Lets `pretooluse.ts`
   * record an avoided read in the ledger without having to re-derive which
   * branch produced the verdict by matching on its prose.
   *
   * Reported separately from compression savings (`optiflow savings`): "this
   * output shrank" and "this read did not happen" are different claims, and
   * totalling them together would overstate both.
   */
  suppressedReadBytes?: number;
}

/** Whether a path names an existing directory. Never throws. */
function isDirectory(path: string): boolean {
  if (!isFsSafePath(path)) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Dump commands as a whole word, matched against a runnable command string. */
const DUMP_COMMANDS = /\b(?:cat|bat|head|tail|more|less|type|Get-Content|gc)\b/;
const DUMP_HEAD = /^(?:cat|bat|head|tail|more|less|type|Get-Content|gc)$/i;
const RECURSIVE_SEARCH = /\b(?:grep|egrep|fgrep|rg|ag|ack|findstr|Select-String|sls)\b/;
const SEARCH_TOOL = /^(?:grep|egrep|fgrep|rg|ag|ack|findstr|Select-String|sls)$/i;
const RECURSES_BY_DEFAULT = /^(?:rg|ag|ack)$/i;
const COMMAND_PREFIX = /^(?:sudo|time|env|command|nice|ionice|nohup|xargs)$/;

/** Removes heredoc BODIES, which are data the command carries rather than commands the shell will run. */
function stripHeredocs(command: string): string {
  const lines = String(command).split("\n");
  const out: string[] = [];
  let delimiter: string | null = null;

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

/** Command segments, split on operators that end one command's stdout. */
function segmentsOf(command: string): string[] {
  return String(command)
    .split(/\|\||&&|[|;&\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does this segment send its stdout to a file? */
function redirectsStdoutToFile(segment: string): boolean {
  return /(?:^|[^0-9&2])>>?\s*(?!&)\S+/.test(String(segment));
}

/** Does this command DUMP file contents, rather than merely naming a file? */
export function isContentDump(command: unknown): boolean {
  if (typeof command !== "string") return false;
  const runnable = stripHeredocs(command);
  if (RECURSIVE_SEARCH.test(runnable)) return true;
  if (!DUMP_COMMANDS.test(runnable)) return false;

  return segmentsOf(runnable).some(
    (segment) => DUMP_COMMANDS.test(segment) && !redirectsStdoutToFile(segment)
  );
}

/** Splits a command into pipeline/list segments WITHOUT splitting inside quotes. */
function shellSegments(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;

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

/** Is this command an unbounded recursive search? Asked per segment, of the segment's head word. */
export function isRecursiveSearch(command: unknown): boolean {
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

/** Pulls candidate file arguments out of a shell command (first pipeline segment only). */
function fileOperands(command: string): string[] {
  const operands: string[] = [];
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

function candidatePaths(operand: string, cwd?: string): string[] {
  return resolvableCandidates(operand, cwd);
}

/** The project a COMMAND belongs to (honors an in-command `cd`, same rule as `touchedFiles`). */
export function commandProjectRoot(payload: NormalizedPayload, fallback?: string): string | null {
  const raw = payload?.tool_input?.command;
  const base = payload?.cwd ?? fallback;
  if (typeof raw === "string") {
    const command = stripHeredocs(raw);
    const cd = /(?:^|\n|;|&&)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(command);
    if (cd) {
      const target = canonicalPath(cd[1].replace(/^['"]|['"]$/g, ""), base);
      if (isDirectory(target)) return projectRootFor(join(target, "__command__"), base);
    }
  }
  return projectRootFor(join(base || process.cwd(), "__command__"), base);
}

export interface TouchedFile {
  path: string;
  size: number;
}

/** Every real file this call touches, canonicalised. Only paths that RESOLVE are returned. */
export function touchedFiles(payload: NormalizedPayload): TouchedFile[] {
  const input = payload?.tool_input || {};
  const out = new Map<string, number>();

  const command = typeof input.command === "string" ? stripHeredocs(input.command) : "";
  const cd = /(?:^|\n|;|&&)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(command);
  const cdTarget = cd ? canonicalPath(cd[1].replace(/^['"]|['"]$/g, ""), payload?.cwd) : null;
  const cwd = cdTarget && isDirectory(cdTarget) ? cdTarget : payload?.cwd;

  const add = (candidate: unknown) => {
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
  add((input as Record<string, unknown>).path);
  add((input as Record<string, unknown>).notebook_path);

  for (const match of command.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm)) {
    add(match[1].trim().replace(/^['"]|['"]$/g, ""));
  }
  for (const match of command.matchAll(/^\*\*\* Move to:\s*(.+)$/gm)) {
    add(match[1].trim().replace(/^['"]|['"]$/g, ""));
  }

  for (const segment of command.split("|")) {
    for (const operand of fileOperands(segment)) add(operand);
  }

  return [...out].map(([path, size]) => ({ path, size }));
}

/** The first large file this command will ACTUALLY PRINT (dump check and operand lookup share a segment). */
function largeDumpedOperand(command: string, cwd?: string): { path: string; size: number } | null {
  const threshold = largeFileBytes();

  for (const segment of shellSegments(stripHeredocs(command))) {
    const tokens = segment.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g) || [];

    let i = 0;
    while (i < tokens.length && (/^\w+=/.test(tokens[i]) || COMMAND_PREFIX.test(tokens[i]))) i++;
    if (i >= tokens.length) continue;
    if (!DUMP_HEAD.test(tokens[i].replace(/^.*[/\\]/, ""))) continue;

    for (const operand of fileOperands(tokens.slice(i).join(" "))) {
      for (const path of candidatePaths(operand, cwd)) {
        const size = fileSize(path);
        if (size >= threshold && !isBinaryPath(path) && !isMachineOwned(path)) {
          return { path: operand, size };
        }
      }
    }
  }

  return null;
}

/** Resolves the first operand that is a real file over the size threshold. */
function largeOperand(command: string, cwd?: string): { path: string; size: number } | null {
  const threshold = largeFileBytes();
  for (const operand of fileOperands(command)) {
    for (const path of candidatePaths(operand, cwd)) {
      const size = fileSize(path);
      if (size >= threshold && !isBinaryPath(path) && !isMachineOwned(path)) {
        return { path: operand, size };
      }
    }
  }
  return null;
}

/** Canonical tool names, per client (Claude Code's own six pass through unchanged). */
const TOOL_ALIASES = new Map(
  Object.entries({
    read: "Read", read_file: "Read", view_file: "Read", readfile: "Read", view: "Read",
    str_replace_editor_view: "Read", open_file: "Read",
    grep: "Grep", search_file_content: "Grep", grep_search: "Grep", ripgrep_search: "Grep",
    codebase_search: "Grep", search: "Grep",
    glob: "Glob", find_files: "Glob", file_search: "Glob", list_dir: "Glob", glob_file_search: "Glob",
    edit: "Edit", edit_file: "Edit", replace: "Edit", apply_patch: "Edit", str_replace: "Edit",
    multiedit: "Edit", search_replace: "Edit",
    write: "Write", write_file: "Write", create_file: "Write",
    bash: "Bash", powershell: "Bash", pwsh: "Bash", shell: "Bash", run_command: "Bash",
    execute_command: "Bash", run_shell_command: "Bash", run_terminal_cmd: "Bash", terminal: "Bash",
  })
);

/** Maps a client's tool name onto the canonical one, or null if unhandled. */
export function normalizeTool(name: unknown): string | null {
  if (!name) return null;
  if (["Read", "Grep", "Glob", "Edit", "MultiEdit", "Write", "Bash"].includes(String(name))) {
    return String(name);
  }
  return TOOL_ALIASES.get(String(name).toLowerCase()) || null;
}

/** Normalizes payload shape across clients (argument envelope + path key). */
export function normalizePayload(raw: Record<string, unknown>): NormalizedPayload {
  const rawInput =
    (raw.tool_input as unknown) ??
    (raw.toolInput as unknown) ??
    (raw.tool_args as unknown) ??
    (raw.toolArgs as unknown) ??
    (raw.arguments as unknown) ??
    (raw.args as unknown) ??
    (raw.parameters as unknown) ??
    {};
  let input: Record<string, unknown> = rawInput as Record<string, unknown>;
  if (typeof rawInput === "string") {
    try {
      input = JSON.parse(rawInput);
    } catch {
      input = {};
    }
  }
  const filePath =
    input.file_path ?? input.path ?? input.absolute_path ?? input.filePath ?? input.target_file;
  const command = input.command ?? input.cmd ?? input.script;

  const cwd = (raw.cwd as string) ?? (raw.workspace_root as string) ?? process.cwd();

  return {
    session_id: String(raw.session_id ?? raw.sessionId ?? raw.conversation_id ?? "default"),
    transcript_path: (raw.transcript_path as string) ?? (raw.transcriptPath as string) ?? null,
    cwd,
    tool_name: normalizeTool(raw.tool_name ?? raw.toolName ?? raw.tool),
    tool_input: {
      ...input,
      ...(filePath !== undefined ? { file_path: canonicalPath(filePath, cwd) } : {}),
      ...(filePath !== undefined ? { raw_file_path: filePath } : {}),
      ...(command !== undefined ? { command: String(command) } : {}),
      ...(input.start_line !== undefined ? { offset: input.start_line } : {}),
      ...(input.end_line !== undefined ? { limit: input.end_line } : {}),
    },
  };
}

/** A skip rule covering this path, if one is in force. */
function matchingRule(cwd: string | undefined, path: string) {
  const canonical = canonicalPath(path);
  for (const rule of activeRules(wikiDir(cwd))) {
    if (rule.type !== "skip" && rule.type !== "skeleton-only") continue;
    if (rule.anchor && rule.anchor === canonical) return rule;
  }
  return null;
}

/**
 * Whether a replacement schema is positively available to this hook session.
 * `undefined` preserves the pure decision API for callers that evaluate
 * policy in isolation; production always passes a Set (possibly empty).
 */
function replacementAvailable(availableTools: Set<string> | string[] | undefined, name: string): boolean {
  if (availableTools === undefined) return true;
  return availableTools instanceof Set ? availableTools.has(name) : availableTools.includes(name);
}

export function decide(
  payload: NormalizedPayload,
  state: { seen: Record<string, SeenEntry> },
  availableTools?: Set<string> | string[]
): Verdict | null {
  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  const threshold = largeFileBytes();

  if (tool === "Read") {
    const path = input.file_path;
    const shown = input.raw_file_path ?? path;
    if (!path || isBinaryPath(path) || isMachineOwned(path)) return null;

    if (input.offset != null || input.limit != null) return null;

    const size = fileSize(path);
    if (size < 0) return null;

    if (size < refusalFloorBytes()) return null;

    const rule = matchingRule(payload.cwd, path);
    if (rule && replacementAvailable(availableTools, "smart_read")) {
      return {
        key: `read:${path}`,
        reason:
          `${shown} is covered by a fix applied on ${new Date(rule.appliedAt).toISOString().slice(0, 10)}: ` +
          `${rule.why}. Call smart_read with path="${shown}" for its structure, or ` +
          `revert the rule with id "${rule.id}" if it is wrong.`,
      };
    }

    const seenEntry = state.seen[path];
    if (seenEntry && replacementAvailable(availableTools, "smart_read")) {
      // Byte-identical to the copy already in context: there is nothing to
      // return, not even a diff, so this refuses outright instead of
      // spending a second round trip on `smart_read`. Note the ranged-read
      // escape above (`offset`/`limit` returned null) -- a model narrowing
      // in on a region is doing the right thing and is never blocked -- and
      // that a second identical attempt is let through as advisory by
      // `enforceVerdict`'s repeat handling, so this can't wedge.
      if (unchangedSinceSeen(path, seenEntry)) {
        return {
          key: `read:${path}`,
          suppressedReadBytes: size,
          reason:
            `${shown} has not changed since you read it earlier in this ` +
            `session -- its contents are already in your context above. If ` +
            `you need a specific region again, re-read it with offset/limit, ` +
            `which is never blocked.`,
        };
      }
      return {
        key: `read:${path}`,
        reason:
          `You already read ${shown} earlier in this session. Call the ` +
          `token-optimizer MCP tool smart_read with path="${shown}" instead -- ` +
          `it returns only a diff of what changed since that read, typically a ` +
          `few tokens rather than the whole file.`,
      };
    }

    if (size >= threshold && replacementAvailable(availableTools, "smart_read")) {
      return {
        key: `read:${path}`,
        reason:
          `${shown} is ${KB(size)} KB, large enough to cost a meaningful share ` +
          `of the context window. Call the token-optimizer MCP tool smart_read ` +
          `with path="${shown}" instead -- it caches the content and returns ` +
          `diffs on later reads.`,
      };
    }
    return null;
  }

  if (tool === "Grep") {
    if (input.output_mode && input.output_mode !== "content") return null;
    if (!replacementAvailable(availableTools, "smart_grep")) return null;
    const pattern = (input.pattern as string) || "";
    return {
      key: `grep:${pattern}:${(input.path as string) || ""}`,
      reason:
        `Call the token-optimizer MCP tool smart_grep instead of the built-in ` +
        `Grep (pattern="${pattern}"). It returns deduplicated, context-trimmed ` +
        `matches rather than every raw hit.`,
    };
  }

  if (tool === "Glob") {
    if (!replacementAvailable(availableTools, "smart_glob")) return null;
    const pattern = (input.pattern as string) || "";
    return {
      key: `glob:${pattern}`,
      reason:
        `Call the token-optimizer MCP tool smart_glob instead of the built-in ` +
        `Glob (pattern="${pattern}"). It returns filtered, paginated paths ` +
        `rather than an unbounded match list.`,
    };
  }

  if (tool === "Edit" || tool === "MultiEdit") {
    if (!replacementAvailable(availableTools, "smart_edit")) return null;
    const path = input.file_path;
    if (!path) return null;
    const size = fileSize(path);
    if (size < threshold) return null;
    return {
      key: `edit:${path}`,
      reason:
        `${path} is ${KB(size)} KB. Call the token-optimizer MCP tool ` +
        `smart_edit with path="${path}" instead -- it applies the change and ` +
        `returns a compact unified diff rather than echoing the file.`,
    };
  }

  if (tool === "Write") {
    if (!replacementAvailable(availableTools, "smart_write")) return null;
    const path = input.file_path;
    const content = input.content || "";
    if (!path || content.length < threshold) return null;
    return {
      key: `write:${path}`,
      reason:
        `You are writing ${KB(content.length)} KB to ${path}. Call the ` +
        `token-optimizer MCP tool smart_write instead -- it stores the content ` +
        `through the cache so later reads of this file diff against it.`,
    };
  }

  if (tool === "Bash") {
    const command = input.command || "";

    {
      const hit = largeDumpedOperand(command, payload.cwd);
      if (hit && replacementAvailable(availableTools, "smart_read")) {
        return {
          key: `bash:${hit.path}`,
          reason:
            `This command prints ${hit.path} (${KB(hit.size)} KB) into the ` +
            `context. Call the token-optimizer MCP tool smart_read with ` +
            `path="${hit.path}" instead -- same content, cached and diffed.`,
        };
      }
    }

    if (isRecursiveSearch(command) && replacementAvailable(availableTools, "smart_grep")) {
      if (!largeOperand(command, payload.cwd)) {
        return {
          key: `bash:search:${command.slice(0, 80)}`,
          reason:
            `Recursive shell searches return unbounded output. Call the ` +
            `token-optimizer MCP tool smart_grep instead -- it caps and ` +
            `deduplicates results before they reach the context window.`,
        };
      }
    }
  }

  return null;
}

/**
 * True when `path` is byte-identical to what the session read, recently
 * enough for "it's already in your context" to still hold.
 *
 * Fails CLOSED (returns false, i.e. no suppression) on anything uncertain:
 * suppression disabled, no recorded hash (a migrated pre-hash entry), the
 * window elapsed, or the file unreadable/unhashable now. The cost of a
 * wrong `false` is one redirect; the cost of a wrong `true` is refusing a
 * read the model genuinely needed.
 */
function unchangedSinceSeen(path: string, entry: SeenEntry): boolean {
  if (!repeatedReadSuppressionEnabled()) return false;
  if (!entry.hash) return false;

  const windowMs = repeatedReadWindowMs();
  if (windowMs > 0) {
    if (!entry.at) return false;
    if (Date.now() - entry.at > windowMs) return false;
  }

  return safeHashFile(path) === entry.hash;
}

/** `hashFile` throws on an unreadable file; every caller here wants "unknown" instead. */
function safeHashFile(path: string): string {
  try {
    return hashFile(path);
  } catch {
    return "";
  }
}

/**
 * Records a successful (allowed) READ so a later repeat is recognised.
 * READ ONLY.
 *
 * Stores the content hash alongside, which is what lets the router
 * distinguish an unchanged re-read (nothing to return) from a changed one
 * (`smart_read` can diff it). An unhashable file records `""`, which never
 * licenses suppression.
 */
export function remember(payload: NormalizedPayload, state: { seen: Record<string, SeenEntry> }): void {
  const path = payload.tool_input?.file_path;
  if (path && payload.tool_name === "Read") {
    state.seen[path] = { hash: safeHashFile(path), at: Date.now() };
  }
}

/** The size an allowed read actually cost, or 0 when it is not a read. */
export function readCostBytes(payload: NormalizedPayload): number {
  if (payload.tool_name !== "Read") return 0;
  const path = payload.tool_input?.file_path;
  if (!path || isBinaryPath(path)) return 0;
  const size = fileSize(path);
  return size > 0 ? size : 0;
}
