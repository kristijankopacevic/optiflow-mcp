// Integration test: writes the activity beacon with THIS module's
// `writeActivityBeacon`, then reads it back with Phase 4's REAL
// `readActivityBeacon` (imported directly from `src/statusline/io.ts`, never
// reimplemented/mocked) — proving the two modules actually agree on the
// contract, not just that their types look similar on paper.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readActivityBeacon } from "../statusline/io.js";
import { writeActivityBeacon } from "./activity.js";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-activity-home-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe("writeActivityBeacon -> readActivityBeacon round trip (cross-phase contract)", () => {
  it("writes to ~/.optiflow/activity.json in the exact documented shape", () => {
    writeActivityBeacon({ tool: "Bash", timestamp: 12345 }, { home: homeDir });
    const filePath = path.join(homeDir, "activity.json");
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ tool: "Bash", timestamp: 12345 });
  });

  it("Phase 4's real readActivityBeacon reads back exactly what this module wrote", () => {
    writeActivityBeacon({ tool: "Read", timestamp: 999_999 }, { home: homeDir });
    const beacon = readActivityBeacon({ home: homeDir });
    expect(beacon).toEqual({ tool: "Read", timestamp: 999_999 });
  });

  it("a second write overwrites the first (only the most recent tool call is tracked)", () => {
    writeActivityBeacon({ tool: "Bash", timestamp: 1 }, { home: homeDir });
    writeActivityBeacon({ tool: "Edit", timestamp: 2 }, { home: homeDir });
    expect(readActivityBeacon({ home: homeDir })).toEqual({ tool: "Edit", timestamp: 2 });
  });

  it("creates ~/.optiflow itself if it doesn't exist yet", () => {
    const freshHome = path.join(homeDir, "does-not-exist-yet");
    writeActivityBeacon({ tool: "Grep", timestamp: 5 }, { home: freshHome });
    expect(readActivityBeacon({ home: freshHome })).toEqual({ tool: "Grep", timestamp: 5 });
  });

  it("never throws even against an unwritable target (defensive, fire-and-forget)", () => {
    // A path that can't be created as a directory (its parent is a file, not a dir).
    const notADir = path.join(homeDir, "im-a-file");
    writeFileSync(notADir, "x", "utf8");
    expect(() => writeActivityBeacon({ tool: "Bash", timestamp: 1 }, { home: path.join(notADir, "nested") })).not.toThrow();
  });
});
