import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTranscriptFile, parseTranscriptLine, parseTranscriptText } from "./parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILE = path.resolve(__dirname, "../../fixtures/transcripts/sample.jsonl");

let logHome: string;

beforeEach(() => {
  logHome = mkdtempSync(path.join(tmpdir(), "optiflow-transcript-parse-test-"));
});

afterEach(() => {
  rmSync(logHome, { recursive: true, force: true });
});

describe("parseTranscriptLine", () => {
  it("parses a real-shaped assistant line with usage", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "u1",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      isSidechain: false,
      message: { id: "msg_1", model: "m", role: "assistant", usage: { input_tokens: 5, output_tokens: 10 } },
    });
    const record = parseTranscriptLine(line, { logHome });
    expect(record).not.toBeNull();
    expect(record?.type).toBe("assistant");
    expect(record?.message?.usage?.input_tokens).toBe(5);
  });

  it("returns null (never throws) for malformed JSON", () => {
    expect(() => parseTranscriptLine("{{{ not json", { logHome })).not.toThrow();
    expect(parseTranscriptLine("{{{ not json", { logHome })).toBeNull();
  });

  it("returns null for JSON that parses but isn't a plain object (e.g. a bare array)", () => {
    expect(parseTranscriptLine('["a", "b"]', { logHome })).toBeNull();
  });

  it("returns null for a blank line", () => {
    expect(parseTranscriptLine("   ", { logHome })).toBeNull();
  });

  it("preserves unmodeled top-level keys (e.g. type: queue-operation) rather than rejecting them", () => {
    const record = parseTranscriptLine(
      JSON.stringify({ type: "queue-operation", operation: "enqueue", sessionId: "s1" }),
      { logHome }
    );
    expect(record).toMatchObject({ type: "queue-operation", operation: "enqueue" });
  });
});

describe("parseTranscriptText", () => {
  it("parses a file with mixed line types, skipping malformed/non-object lines without crashing", () => {
    const text = [
      JSON.stringify({ type: "queue-operation", sessionId: "s1" }),
      JSON.stringify({ type: "user", uuid: "u0", sessionId: "s1", message: { role: "user", content: [] } }),
      JSON.stringify({
        type: "assistant",
        uuid: "u1",
        sessionId: "s1",
        message: { id: "msg_1", role: "assistant", usage: { input_tokens: 1, output_tokens: 2 } },
      }),
      "not valid json {{{",
      '["array", "not object"]',
      "",
      JSON.stringify({
        type: "assistant",
        uuid: "u2",
        sessionId: "s1",
        message: { id: "msg_2", role: "assistant", usage: { input_tokens: 3, output_tokens: 4 } },
      }),
    ].join("\n");

    const result = parseTranscriptText(text, { logHome });

    expect(result.skipped).toBe(2); // malformed line + bare array line
    expect(result.records).toHaveLength(4); // queue-operation, user, 2 assistants
    expect(result.totalLines).toBe(6); // blank line excluded from totalLines
    expect(result.records.filter((r) => r.type === "assistant")).toHaveLength(2);
  });

  it("returns an empty result for empty input", () => {
    const result = parseTranscriptText("", { logHome });
    expect(result).toEqual({ records: [], skipped: 0, totalLines: 0 });
  });
});

describe("parseTranscriptFile", () => {
  it("streams the real fixture file and parses real-schema fields correctly", async () => {
    const result = await parseTranscriptFile(FIXTURE_FILE, { logHome });

    // 10 non-blank lines in the fixture; 2 are deliberately malformed/non-object.
    expect(result.totalLines).toBe(10);
    expect(result.skipped).toBe(2);
    expect(result.records).toHaveLength(8);

    const assistantRecords = result.records.filter((r) => r.type === "assistant");
    expect(assistantRecords.length).toBeGreaterThan(0);
    for (const record of assistantRecords) {
      expect(record.message?.usage).toBeDefined();
      expect(typeof record.message?.usage?.input_tokens).toBe("number");
    }

    const sidechainRecords = result.records.filter((r) => r.isSidechain === true);
    expect(sidechainRecords.length).toBe(2);
  });

  it("rejects (rather than silently returning empty) when the file itself doesn't exist", async () => {
    await expect(
      parseTranscriptFile(path.join(logHome, "does-not-exist.jsonl"), { logHome })
    ).rejects.toBeTruthy();
  });
});
