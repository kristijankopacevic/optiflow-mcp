import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { parseTranscriptFile } from "./parse.js";
import type { TranscriptRecord } from "./parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILE = path.resolve(__dirname, "../../fixtures/transcripts/sample.jsonl");

function assistantTurn(overrides: Partial<TranscriptRecord> & { usage: Record<string, unknown> }): TranscriptRecord {
  const { usage, ...rest } = overrides;
  return {
    type: "assistant",
    isSidechain: false,
    sessionId: "s1",
    message: { id: rest.uuid as string, role: "assistant", usage },
    ...rest,
  } as TranscriptRecord;
}

let logHome: string;

beforeEach(() => {
  logHome = mkdtempSync(path.join(tmpdir(), "optiflow-transcript-analyze-test-"));
});

afterEach(() => {
  rmSync(logHome, { recursive: true, force: true });
});

describe("analyze — cache-break detection", () => {
  it("does NOT flag a normal incremental-caching sequence as a break", () => {
    const records: TranscriptRecord[] = [
      assistantTurn({
        uuid: "t1",
        timestamp: "2026-01-01T00:00:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 50 },
      }),
      // Reuses (almost) all of t1's cache total (1000) via cache_read, and
      // only adds a small incremental delta — this is the NORMAL steady
      // state, not a break.
      assistantTurn({
        uuid: "t2",
        timestamp: "2026-01-01T00:01:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 40 },
      }),
    ];

    const result = analyze(records);
    expect(result.cacheBreaks).toHaveLength(0);
  });

  it("flags a break when cache_read collapses far below what the previous turn had cached (TTL expiry / /compact)", () => {
    const records: TranscriptRecord[] = [
      assistantTurn({
        uuid: "t1",
        timestamp: "2026-01-01T00:00:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 50 },
      }),
      assistantTurn({
        uuid: "t2",
        timestamp: "2026-01-01T00:01:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 40 },
      }),
      // Two days later: cache_read is 0 despite t2 having a cache total of
      // 1100 — the whole prefix had to be re-primed from scratch.
      assistantTurn({
        uuid: "t3",
        timestamp: "2026-01-03T00:00:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 900, cache_read_input_tokens: 0, output_tokens: 30 },
      }),
    ];

    const result = analyze(records);
    expect(result.cacheBreaks).toHaveLength(1);
    expect(result.cacheBreaks[0]).toMatchObject({ thread: "main", turnId: "t3", previousTurnId: "t2" });
  });

  it("does not flag the very first turn (no predecessor to break from)", () => {
    const records: TranscriptRecord[] = [
      assistantTurn({
        uuid: "only",
        timestamp: "2026-01-01T00:00:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 500, cache_read_input_tokens: 0, output_tokens: 10 },
      }),
    ];
    expect(analyze(records).cacheBreaks).toHaveLength(0);
  });
});

describe("analyze — dedup by message.id", () => {
  it("counts a message split across multiple lines (same message.id, identical usage) exactly once", () => {
    const usage = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 20 };
    const records: TranscriptRecord[] = [
      { type: "assistant", uuid: "line-a", isSidechain: false, sessionId: "s1", timestamp: "2026-01-01T00:00:00.000Z", message: { id: "msg_dup", role: "assistant", usage } },
      { type: "assistant", uuid: "line-b", isSidechain: false, sessionId: "s1", timestamp: "2026-01-01T00:00:00.500Z", message: { id: "msg_dup", role: "assistant", usage } },
    ];

    const result = analyze(records);
    expect(result.turnCount).toBe(1);
    expect(result.totals.totalTokens).toBe(2 + 100 + 0 + 20);
  });
});

describe("analyze — subagent rollup", () => {
  it("separates sidechain turns (grouped by their chain root) from the main thread", () => {
    const mainUsage = { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 };
    const subUsage1 = { input_tokens: 1, cache_creation_input_tokens: 300, cache_read_input_tokens: 0, output_tokens: 80 };
    const subUsage2 = { input_tokens: 1, cache_creation_input_tokens: 50, cache_read_input_tokens: 300, output_tokens: 60 };

    const records: TranscriptRecord[] = [
      { type: "assistant", uuid: "m1", isSidechain: false, sessionId: "s1", timestamp: "2026-01-01T00:00:00.000Z", message: { id: "msg_m1", role: "assistant", usage: mainUsage } },
      {
        type: "assistant",
        uuid: "sub1",
        parentUuid: "anchor-task",
        isSidechain: true,
        sessionId: "s1",
        timestamp: "2026-01-01T00:01:00.000Z",
        message: { id: "msg_sub1", role: "assistant", usage: subUsage1 },
      },
      {
        type: "assistant",
        uuid: "sub2",
        parentUuid: "sub1",
        isSidechain: true,
        sessionId: "s1",
        timestamp: "2026-01-01T00:02:00.000Z",
        message: { id: "msg_sub2", role: "assistant", usage: subUsage2 },
      },
    ];

    const result = analyze(records);

    expect(result.mainThreadTurnCount).toBe(1);
    expect(result.sidechainTurnCount).toBe(2);
    expect(result.subagents).toHaveLength(1);
    expect(result.subagents[0].rootUuid).toBe("anchor-task");
    expect(result.subagents[0].turnCount).toBe(2);
    expect(result.subagents[0].totalTokens).toBe(1 + 300 + 0 + 80 + (1 + 50 + 300 + 60));

    // Main-thread totals must not include subagent tokens.
    const mainOnlyTotal = 2 + 10 + 0 + 5;
    expect(result.sessions[0].totalTokens).toBe(mainOnlyTotal + result.subagents[0].totalTokens);
  });
});

describe("analyze — top-N ranking", () => {
  it("ranks turns by total tokens descending and respects topN", () => {
    const make = (uuid: string, minute: number, total: number) => ({
      type: "assistant" as const,
      uuid,
      isSidechain: false,
      sessionId: "s1",
      timestamp: `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`,
      message: { id: `msg_${uuid}`, role: "assistant", usage: { input_tokens: total, output_tokens: 0 } },
    });
    const records: TranscriptRecord[] = [make("01", 1, 10), make("02", 2, 500), make("03", 3, 100)] as TranscriptRecord[];

    const result = analyze(records, { topN: 2 });
    expect(result.topTurns).toHaveLength(2);
    expect(result.topTurns[0].totalTokens).toBe(500);
    expect(result.topTurns[1].totalTokens).toBe(100);
  });
});

describe("analyze — totals against hand-computed fixture expectations", () => {
  it("matches hand-computed totals for fixtures/transcripts/sample.jsonl", async () => {
    const { records } = await parseTranscriptFile(FIXTURE_FILE, { logHome });
    const result = analyze(records);

    // Hand-computed from the fixture file's usage fields:
    //   main: msg_1(5+1000+0+200=1205) + msg_2(5+200+1000+150=1355) + msg_4(5+500+0+90=595) = 3155
    //   sub:  msg_sub_1(3+300+0+80=383) + msg_sub_2(3+50+300+60=413) = 796
    expect(result.mainThreadTurnCount).toBe(3);
    expect(result.sidechainTurnCount).toBe(2);
    expect(result.turnCount).toBe(5);
    expect(result.totals.totalTokens).toBe(3155 + 796);
    expect(result.totals.thinkingTokens).toBe(50 + 30 + 10 + 5 + 20);
    expect(result.totals.cacheCreationEphemeral1h).toBe(1000 + 0 + 300 + 0 + 500);
    expect(result.totals.cacheCreationEphemeral5m).toBe(0 + 200 + 0 + 50 + 0);

    // Exactly one cache break: msg_4 after the multi-day gap.
    expect(result.cacheBreaks).toHaveLength(1);
    expect(result.cacheBreaks[0].thread).toBe("main");

    // One subagent group, rooted at the anchor not present in the fixture.
    expect(result.subagents).toHaveLength(1);
    expect(result.subagents[0].rootUuid).toBe("anchor-task-1");
    expect(result.subagents[0].totalTokens).toBe(796);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sessionId).toBe("sess-fixture-1");
    expect(result.sessions[0].totalTokens).toBe(3155 + 796);
  });
});

describe("analyze — range filtering", () => {
  it("computes cache breaks over the FULL sequence, then filters displayed turns/breaks by range", () => {
    const records: TranscriptRecord[] = [
      assistantTurn({
        uuid: "t1",
        timestamp: "2026-01-01T00:00:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 10 },
      }),
      assistantTurn({
        uuid: "t2",
        timestamp: "2026-01-01T00:01:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 },
      }),
      // Break relative to t2, but happens to fall inside the requested range.
      assistantTurn({
        uuid: "t3",
        timestamp: "2026-01-03T00:00:00.000Z",
        usage: { input_tokens: 2, cache_creation_input_tokens: 900, cache_read_input_tokens: 0, output_tokens: 10 },
      }),
    ];

    // Range covers only t3 — if adjacency were computed AFTER filtering,
    // t3 would have no visible predecessor and the break would be missed.
    const result = analyze(records, { rangeStartMs: new Date("2026-01-02T00:00:00.000Z").getTime() });

    expect(result.turnCount).toBe(1);
    expect(result.cacheBreaks).toHaveLength(1);
    expect(result.cacheBreaks[0].turnId).toBe("t3");
  });
});
