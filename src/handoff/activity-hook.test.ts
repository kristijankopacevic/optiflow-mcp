import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readActivityBeacon } from "../statusline/io.js";
import { runActivityHook, type ActivityPreToolUseHookInput } from "./activity-hook.js";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-activity-hook-home-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

async function reader(value: ActivityPreToolUseHookInput | null): Promise<ActivityPreToolUseHookInput | null> {
  return value;
}

describe("runActivityHook", () => {
  it("always returns a bare {} — never expresses a permission opinion", async () => {
    const output = await runActivityHook(() => reader({ tool_name: "Bash" }), { home: homeDir, now: 1 });
    expect(output).toEqual({});
  });

  it("writes a beacon readable by Phase 4's real readActivityBeacon", async () => {
    await runActivityHook(() => reader({ tool_name: "Edit" }), { home: homeDir, now: 42_000 });
    expect(readActivityBeacon({ home: homeDir })).toEqual({ tool: "Edit", timestamp: 42_000 });
  });

  it("fires for ANY tool_name, not just Bash (the whole point of the broad matcher)", async () => {
    await runActivityHook(() => reader({ tool_name: "mcp__token-optimizer__smart_read" }), { home: homeDir, now: 5 });
    expect(readActivityBeacon({ home: homeDir })).toEqual({ tool: "mcp__token-optimizer__smart_read", timestamp: 5 });
  });

  it("writes nothing when tool_name is absent/empty, but still returns {}", async () => {
    const output = await runActivityHook(() => reader({}), { home: homeDir, now: 1 });
    expect(output).toEqual({});
    expect(readActivityBeacon({ home: homeDir })).toBeNull();
  });

  it("returns {} (never throws) when stdin is null", async () => {
    const output = await runActivityHook(() => reader(null), { home: homeDir });
    expect(output).toEqual({});
  });
});
