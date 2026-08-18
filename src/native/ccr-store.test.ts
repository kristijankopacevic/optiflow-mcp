import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCcr, putCcr } from "./ccr-store.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-ccr-store-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("ccr-store put/get round-trip", () => {
  it("round-trips a stored value by hash", () => {
    putCcr("abc123", "the original full content", { home });
    expect(getCcr("abc123", { home })).toBe("the original full content");
  });

  it("returns undefined for a missing key", () => {
    expect(getCcr("does-not-exist", { home })).toBeUndefined();
  });

  it("returns undefined when the store file does not exist yet", () => {
    expect(getCcr("anything", { home })).toBeUndefined();
  });

  it("last-write-wins when the same hash is stored twice", () => {
    putCcr("dup", "first value", { home });
    putCcr("dup", "second value", { home });
    expect(getCcr("dup", { home })).toBe("second value");
  });

  it("keeps distinct hashes independent", () => {
    putCcr("hash-a", "content a", { home });
    putCcr("hash-b", "content b", { home });
    expect(getCcr("hash-a", { home })).toBe("content a");
    expect(getCcr("hash-b", { home })).toBe("content b");
  });

  it("skips unparseable lines instead of throwing", () => {
    const file = path.join(home, "ccr-store.jsonl");
    const goodLine = JSON.stringify({
      hash: "ok-hash",
      content: "ok content",
      timestamp: new Date().toISOString(),
    });
    writeFileSync(file, `not json at all\n${goodLine}\n{"incomplete":\n`, "utf8");

    expect(() => getCcr("ok-hash", { home })).not.toThrow();
    expect(getCcr("ok-hash", { home })).toBe("ok content");
  });

  it("putCcr never throws even if the home directory is invalid", () => {
    // A null byte is an invalid path component on every platform, so this
    // exercises the try/catch swallow rather than a real filesystem write.
    expect(() => putCcr("x", "y", { home: "\0invalid" })).not.toThrow();
  });
});
