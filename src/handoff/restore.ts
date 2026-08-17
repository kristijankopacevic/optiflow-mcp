// Module 4: rendering a checkpoint back for a fresh session.
//
// CAP-AWARE BY DEFAULT. The plan's Phase 7 gate is literally
// "checkpoint->restore round-trips, <=10,000 chars", and the whole point of
// this module is producing text that gets pasted/injected straight into a
// live Claude context. `renderRestoreMarkdown` therefore caps its output at
// 10,000 chars BY DEFAULT — the same number `src/core/hook-io.ts` enforces
// for hook stdout, chosen for consistency, not because this markdown is
// literally hook JSON. `renderRestoreMarkdown`'s cap can be opted out of
// (`capChars: false`) for a genuine full-fidelity dump (e.g. redirecting to
// a file for offline inspection) — every real call site in this phase
// (`/optiflow:restore` / `/optiflow:compact-continue`, `optiflow checkpoint
// --restore`) uses the default, capped path.
//
// TWO RENDER FUNCTIONS, because they produce different wire formats:
//   - `renderRestoreMarkdown` — plain markdown, capped as above. Truncation
//     (when triggered) slices the whole rendered document and appends a
//     marker in the SAME TEXT FORMAT `src/core/hook-io.ts`'s `toCappedJson`
//     uses (`...[truncated, N chars omitted]`) so it reads as one
//     documented convention, not two — but it does NOT reuse
//     `toCappedJson` itself: that function shrinks the longest STRING FIELD
//     inside a JSON VALUE and re-serializes, which doesn't fit a plain
//     markdown document (there's no JSON structure to walk, and slicing a
//     markdown string is materially simpler than what `toCappedJson` does).
//     This is a considered fit judgment, not an oversight.
//   - `renderCappedRestoreOutput` — a `HookOutput` (see `src/core/
//     hook-io.ts`), serialized through `toCappedJson` (reused as-is here,
//     since this path IS a JSON value) so a future hook that emits this as
//     real hook stdout gets the same cap contract. Nothing in this phase's
//     hook wiring emits this today — there is no `SessionStart` hook
//     registered in `plugin/hooks/hooks.json` yet (out of scope: this
//     phase's brief is `PreCompact`/`SessionEnd` checkpoint-WRITING, not
//     session-start restore-injection). Exported and tested directly so a
//     future `SessionStart` hook has a ready, already-correct contract.
//
// Never throws on a missing/malformed checkpoint: "no checkpoints exist yet"
// is a normal, expected state (a brand-new project, or one that's never
// compacted/ended a session under optiflow), not an error.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  allowWithContext,
  toCappedJson,
  type HookEventName,
} from "../core/hook-io.js";
import { checkpointId, listCheckpointFiles, type Checkpoint } from "./checkpoint.js";

function isCheckpointShape(value: unknown): value is Checkpoint {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sessionId === "string" &&
    typeof v.timestamp === "number" &&
    typeof v.cwd === "string" &&
    Array.isArray(v.openFiles) &&
    Array.isArray(v.decisions) &&
    Array.isArray(v.nextSteps)
  );
}

/** Reads and shape-validates one checkpoint file. Never throws: any failure resolves to `null`. */
export function loadCheckpoint(filePath: string): Checkpoint | null {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return isCheckpointShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The most recently written checkpoint's file path in `dir`, or `null` if
 * there are none (or none parse). Ordered by in-file `timestamp` (via the
 * shared `listCheckpointFiles`, see `checkpoint.ts` for why NOT filename or
 * mtime order), not by `loadCheckpoint`'s own re-parse.
 */
export function findLatestCheckpoint(dir: string): string | null {
  const entries = listCheckpointFiles(dir);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries[0].filePath;
}

/**
 * Resolves `id` to a checkpoint file path. `id` may be a full checkpoint id
 * (`checkpointId()`'s `<sessionId>-<timestamp>` — matched exactly against
 * the filename stem) or just a bare `sessionId` prefix (matched against
 * every file starting with `<sanitized-id>-`, most recent wins) — the
 * latter is what a user typing `/optiflow:restore <sessionId>` from memory
 * will actually have. Returns `null` if nothing matches.
 */
export function findCheckpointById(dir: string, id: string): string | null {
  const exact = path.join(dir, `${id}.json`);
  if (existsSync(exact)) return exact;

  try {
    const prefix = `${id}-`;
    const matches = listCheckpointFiles(dir).filter((entry) => path.basename(entry.filePath).startsWith(prefix));
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.timestamp - a.timestamp);
    return matches[0].filePath;
  } catch {
    return null;
  }
}

/** Resolves and loads a checkpoint in one call: most recent in `dir` when `id` is omitted, otherwise `findCheckpointById`. */
export function resolveCheckpoint(dir: string, id?: string): Checkpoint | null {
  const filePath = id ? findCheckpointById(dir, id) : findLatestCheckpoint(dir);
  return filePath ? loadCheckpoint(filePath) : null;
}

function bulletList(items: string[], emptyLabel: string): string {
  if (items.length === 0) return `_${emptyLabel}_`;
  return items.map((item) => `- ${item}`).join("\n");
}

/** Default cap for `renderRestoreMarkdown` — see module header for why 10,000. */
const DEFAULT_MARKDOWN_CAP_CHARS = 10_000;

/**
 * Truncates `full` to at most `capChars`, appending a marker in the exact
 * `...[truncated, N chars omitted]` text format `src/core/hook-io.ts`'s
 * `toCappedJson` uses for its own truncation marker (kept in sync
 * deliberately, as one documented convention — see module header on why
 * this doesn't call `toCappedJson` itself). Iterates a few times because
 * the marker's own length depends on `N` (the omitted count), which in turn
 * depends on how much text is kept — a couple of iterations converges since
 * that feedback loop is self-limiting (the marker only grows by a digit at
 * a time as `N` crosses a power of ten).
 */
function truncateMarkdown(full: string, capChars: number): string {
  if (full.length <= capChars) return full;

  let keepLen = Math.max(0, capChars);
  for (let attempt = 0; attempt < 5; attempt++) {
    const omitted = full.length - keepLen;
    const marker = `\n\n...[truncated, ${omitted} chars omitted]`;
    const nextKeepLen = Math.max(0, capChars - marker.length);
    if (nextKeepLen === keepLen) break;
    keepLen = nextKeepLen;
  }

  const omitted = full.length - keepLen;
  const marker = `\n\n...[truncated, ${omitted} chars omitted]`;
  return full.slice(0, keepLen) + marker;
}

export interface RenderRestoreMarkdownOptions {
  /**
   * Caps the rendered markdown to at most this many characters (default
   * 10,000 — see module header). Pass `false` to opt out entirely and get
   * the full, unbounded document (e.g. redirecting to a file for offline
   * inspection) — every real command/CLI call site in this phase uses the
   * default.
   */
  capChars?: number | false;
}

/**
 * Renders a checkpoint (or its absence) as markdown, capped by default —
 * see module header. Never throws.
 */
export function renderRestoreMarkdown(
  checkpoint: Checkpoint | null,
  options: RenderRestoreMarkdownOptions = {}
): string {
  const full = renderRestoreMarkdownFull(checkpoint);
  const capChars = options.capChars === undefined ? DEFAULT_MARKDOWN_CAP_CHARS : options.capChars;
  if (capChars === false) return full;
  return truncateMarkdown(full, capChars);
}

function renderRestoreMarkdownFull(checkpoint: Checkpoint | null): string {
  if (!checkpoint) {
    return [
      "## optiflow session handoff",
      "",
      "No checkpoints found yet. Run `/optiflow:checkpoint [notes]` (or `optiflow checkpoint`) before compacting/ending a session to create one.",
    ].join("\n");
  }

  const when = new Date(checkpoint.timestamp).toISOString();
  const git =
    checkpoint.gitBranch || checkpoint.gitHead
      ? `${checkpoint.gitBranch ?? "(unknown branch)"} @ ${checkpoint.gitHead ?? "(no commits yet)"}`
      : "(not a git repo, or git unavailable at checkpoint time)";

  const tokenOptimizerLine = checkpoint.tokenOptimizerStateRef
    ? `\`${checkpoint.tokenOptimizerStateRef.file}\` (sessionId: \`${checkpoint.tokenOptimizerStateRef.sessionId}\`, ${
        checkpoint.tokenOptimizerStateRef.exists ? "resolvable" : "did not exist at checkpoint time"
      }) — a REFERENCE only; optiflow never copies token-optimizer's own session state.`
    : "(none recorded)";

  return [
    "## optiflow session handoff",
    "",
    `- **Checkpoint id**: \`${checkpointId(checkpoint)}\``,
    `- **Session**: \`${checkpoint.sessionId}\``,
    `- **Taken**: ${when}`,
    `- **cwd**: \`${checkpoint.cwd}\``,
    `- **Git**: ${git}`,
    `- **Model**: ${checkpoint.model ?? "(not recorded)"}`,
    `- **token-optimizer state ref**: ${tokenOptimizerLine}`,
    "",
    "### Decisions",
    bulletList(checkpoint.decisions, "no decisions recorded"),
    "",
    "### Next steps",
    bulletList(checkpoint.nextSteps, "no next steps recorded"),
    "",
    "### Open files",
    bulletList(checkpoint.openFiles, "no open files recorded"),
  ].join("\n");
}

export interface RenderCappedRestoreOptions {
  hookEventName?: HookEventName;
  capChars?: number;
}

/**
 * Renders a checkpoint as a `HookOutput` JSON string, capped at
 * `capChars` (default 10,000, via `src/core/hook-io.ts`'s shared
 * `toCappedJson` — never reimplemented). Not wired to a real hook in this
 * phase (see module header) — exported and tested directly so the contract
 * is proven correct ahead of a future `SessionStart` hook consuming it.
 */
export function renderCappedRestoreOutput(
  checkpoint: Checkpoint | null,
  options: RenderCappedRestoreOptions = {}
): string {
  // Pass the FULL, unbounded markdown here (not `renderRestoreMarkdown`'s
  // own default-capped output) — `toCappedJson` below is itself
  // JSON-size-aware (it accounts for escaping/quoting overhead once
  // embedded in the HookOutput envelope), so pre-truncating the markdown
  // text first would risk two independent truncation markers stacking up.
  const markdown = renderRestoreMarkdown(checkpoint, { capChars: false });
  const output = allowWithContext(options.hookEventName ?? "SessionStart", markdown);
  return toCappedJson(output, options.capChars ?? 10_000);
}
