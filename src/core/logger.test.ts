import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { log } from "./logger.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-logger-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("log", () => {
  it("appends one NDJSON line to logs/<date>.ndjson under the given home", () => {
    const now = new Date("2026-03-14T12:00:00.000Z");
    log({ event: "hook.allow", module: "chop" }, { home, now });

    const file = path.join(home, "logs", "2026-03-14.ndjson");
    const raw = readFileSync(file, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      event: "hook.allow",
      module: "chop",
      timestamp: "2026-03-14T12:00:00.000Z",
    });
  });

  it("appends to the same file across multiple calls on the same date", () => {
    const now = new Date("2026-03-14T12:00:00.000Z");
    log({ event: "first" }, { home, now });
    log({ event: "second" }, { home, now });

    const file = path.join(home, "logs", "2026-03-14.ndjson");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe("first");
    expect(JSON.parse(lines[1]).event).toBe("second");
  });

  it("never throws when the log directory can't be created", () => {
    // Point `home` at a path that is itself an existing *file*, so
    // mkdirSync(path.join(home, "logs"), {recursive:true}) must fail.
    const blockerFile = path.join(home, "not-a-directory");
    writeFileSync(blockerFile, "x", "utf8");

    expect(() => log({ event: "should not throw" }, { home: blockerFile })).not.toThrow();
  });
});
