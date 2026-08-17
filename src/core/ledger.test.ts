import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLedger, readLedger } from "./ledger.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-ledger-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("ledger append/read round-trip", () => {
  it("round-trips a written record", () => {
    appendLedger(
      {
        module: "toon",
        command_or_context: "optiflow toon convert",
        tokensBefore: 1000,
        tokensAfter: 400,
        bytesBefore: 4000,
        bytesAfter: 1600,
      },
      { home }
    );

    const records = readLedger(undefined, { home });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      module: "toon",
      command_or_context: "optiflow toon convert",
      tokensBefore: 1000,
      tokensAfter: 400,
      bytesBefore: 4000,
      bytesAfter: 1600,
    });
    expect(typeof records[0].timestamp).toBe("string");
  });

  it("filters by since", () => {
    appendLedger(
      {
        timestamp: "2020-01-01T00:00:00.000Z",
        module: "chop",
        command_or_context: "git status",
        tokensBefore: 100,
        tokensAfter: 50,
        bytesBefore: 400,
        bytesAfter: 200,
      },
      { home }
    );
    appendLedger(
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        module: "chop",
        command_or_context: "docker ps",
        tokensBefore: 200,
        tokensAfter: 80,
        bytesBefore: 800,
        bytesAfter: 320,
      },
      { home }
    );

    const recent = readLedger("2025-01-01T00:00:00.000Z", { home });
    expect(recent).toHaveLength(1);
    expect(recent[0].command_or_context).toBe("docker ps");
  });

  it("returns an empty array when the ledger file does not exist", () => {
    expect(readLedger(undefined, { home })).toEqual([]);
  });

  it("skips unparseable lines instead of throwing", () => {
    const file = path.join(home, "ledger.jsonl");
    const goodLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      module: "toon",
      command_or_context: "ok",
      tokensBefore: 1,
      tokensAfter: 1,
      bytesBefore: 1,
      bytesAfter: 1,
    });
    writeFileSync(file, `not json at all\n${goodLine}\n{"incomplete":\n`, "utf8");

    expect(() => readLedger(undefined, { home })).not.toThrow();
    const records = readLedger(undefined, { home });
    expect(records).toHaveLength(1);
    expect(records[0].command_or_context).toBe("ok");
  });
});
