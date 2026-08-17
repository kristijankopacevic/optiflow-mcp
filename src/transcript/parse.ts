// Module 2: streaming JSONL parser for Claude Code transcript files
// (`~/.claude/projects/<slug>/<sessionId>.jsonl`).
//
// Schema below is confirmed against REAL local transcript files on this
// machine (not guessed from the plan's secondhand description) — see the
// Phase 6 handoff notes in docs/modules.md for the exact greps used to
// confirm it. Load-bearing findings from that inspection, both baked into
// this parser and into `analyze.ts`:
//
//   1. A transcript line's top-level `type` is NOT limited to
//      "user"/"assistant"/"tool_result" — real files also contain
//      "queue-operation", "attachment", "file-history-snapshot",
//      "summary", "ai-title", and others that carry no `message.usage` at
//      all. This parser keeps every line's `type` as-is (typed as `string`,
//      not a closed union) and never assumes a line has a `message`.
//   2. A single assistant *message* (one `message.id`) can be split across
//      MULTIPLE transcript lines when the response has more than one
//      content block (thinking + text + tool_use each got their own line
//      in samples on this machine) — every line shares the same
//      `message.id` AND an identical `message.usage` object. Consumers
//      that sum `usage` per LINE will double/triple count; `analyze.ts`
//      dedupes by `message.id` before summing anything. This parser does
//      not dedupe (that's an analysis decision, not a parsing one) — it
//      just makes the duplication visible/typed so `analyze.ts` can handle
//      it correctly.
//
// Streams the file (Node's `readline` over a `createReadStream`), never
// `JSON.parse`-ing the whole file as one string — required by the plan for
// files that can be tens of megabytes (observed up to ~25MB locally).
// Malformed/unparseable lines are skipped (logged via `src/core/logger.ts`,
// which itself never throws) rather than aborting the whole parse — one bad
// line must not lose the rest of a session's data.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { log } from "../core/logger.js";

/** `message.usage` — confirmed field names/nesting against real transcript data. */
export interface TranscriptUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: {
    thinking_tokens?: number;
  };
  cache_creation?: {
    ephemeral_1h_input_tokens?: number;
    ephemeral_5m_input_tokens?: number;
  };
  service_tier?: string;
  server_tool_use?: Record<string, unknown>;
  iterations?: unknown[];
  speed?: unknown;
}

/** `message` — confirmed shape; `content` is deliberately `unknown` (block array or string, not needed by this module). */
export interface TranscriptMessage {
  model?: string;
  id?: string;
  type?: string;
  role?: string;
  content?: unknown;
  stop_reason?: string | null;
  stop_details?: unknown;
  usage?: TranscriptUsage;
  diagnostics?: unknown;
}

/**
 * One parsed transcript line. Every field is optional: real lines vary
 * widely by `type` (see module header, finding 1), and this type only
 * documents the keys the plan/task specified plus what was confirmed on
 * this machine — it does not attempt to be an exhaustive closed schema.
 */
export interface TranscriptRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  userType?: string;
  requestId?: string;
  message?: TranscriptMessage;
  toolUseResult?: unknown;
  toolUseID?: string;
  promptId?: string;
  promptSource?: string;
  level?: string;
  leafUuid?: string;
  permissionMode?: string;
  mode?: string;
  /** Anything else present on the line but not modeled above — preserved so nothing is silently lost. */
  [extra: string]: unknown;
}

export interface ParseOptions {
  /** Override `~/.optiflow` for the malformed-line logger (tests only). */
  logHome?: string;
  /** Source file path, used only to make log entries traceable (optional). */
  sourceFile?: string;
}

export interface ParseResult {
  records: TranscriptRecord[];
  /** Count of lines that were non-blank but failed to parse as a JSON object. */
  skipped: number;
  /** Total non-blank lines seen (records.length + skipped). */
  totalLines: number;
}

/**
 * Parses one already-read line. Returns `null` (and logs, never throws) for
 * blank lines, invalid JSON, or JSON that didn't parse to a plain object
 * (e.g. a bare number or array — never seen in real data, but a malformed
 * line could produce anything).
 */
export function parseTranscriptLine(
  line: string,
  options: ParseOptions = {}
): TranscriptRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      log(
        {
          event: "transcript.parse.skip",
          reason: "line did not parse to a JSON object",
          sourceFile: options.sourceFile,
        },
        { home: options.logHome }
      );
      return null;
    }
    return parsed as TranscriptRecord;
  } catch (err) {
    log(
      {
        event: "transcript.parse.skip",
        reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
        sourceFile: options.sourceFile,
        // Bounded preview only — never log a whole (potentially huge) line.
        preview: trimmed.slice(0, 200),
      },
      { home: options.logHome }
    );
    return null;
  }
}

/**
 * Pure, file-free variant used by tests/fixtures: parses NDJSON text
 * already in memory, one line at a time (never `JSON.parse`s the whole
 * blob), skipping malformed lines the same way `parseTranscriptFile` does.
 */
export function parseTranscriptText(text: string, options: ParseOptions = {}): ParseResult {
  const lines = text.split(/\r?\n/);
  const records: TranscriptRecord[] = [];
  let skipped = 0;
  let totalLines = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    totalLines += 1;
    const record = parseTranscriptLine(line, options);
    if (record) {
      records.push(record);
    } else {
      skipped += 1;
    }
  }

  return { records, skipped, totalLines };
}

/**
 * Streams a real transcript `.jsonl` file line-by-line via `readline` over
 * a `createReadStream` — never buffers/`JSON.parse`s the whole file as one
 * string. Malformed lines are skipped (logged, not thrown); a totally
 * unreadable file (missing, permission error) rejects the returned promise
 * so callers (`discover.ts`/CLI) can report which file failed, rather than
 * silently returning an empty result indistinguishable from "empty file."
 */
export async function parseTranscriptFile(
  filePath: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const records: TranscriptRecord[] = [];
  let skipped = 0;
  let totalLines = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    totalLines += 1;
    const record = parseTranscriptLine(line, { ...options, sourceFile: options.sourceFile ?? filePath });
    if (record) {
      records.push(record);
    } else {
      skipped += 1;
    }
  }

  return { records, skipped, totalLines };
}
