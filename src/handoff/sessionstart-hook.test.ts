import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSessionStartHook, type SessionStartHookInput } from "./sessionstart-hook.js";
import { writeCheckpoint, buildCheckpoint, resolveCheckpointDir } from "./checkpoint.js";

let cwd: string;
let home: string;

function reader(input: SessionStartHookInput | null) {
  return async () => input;
}

/** Writes a real checkpoint into the dir the hook will resolve for `cwd`. */
function seedCheckpoint(overrides: Partial<Parameters<typeof buildCheckpoint>[0]> = {}) {
  const dir = resolveCheckpointDir({ cwd, home });
  mkdirSync(dir, { recursive: true });
  const checkpoint = buildCheckpoint({
    sessionId: "seeded-session",
    cwd,
    openFiles: ["src/alpha.ts", "src/beta.ts"],
    decisions: ["chose the bare-array hook shape"],
    nextSteps: ["wire the sessionstart hook"],
    ...overrides,
  } as Parameters<typeof buildCheckpoint>[0]);
  writeCheckpoint(checkpoint, { cwd, home });
  return checkpoint;
}

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "optiflow-sessionstart-cwd-"));
  home = mkdtempSync(path.join(tmpdir(), "optiflow-sessionstart-home-"));
  // A project-root marker, so resolveCheckpointDir anchors inside `cwd`
  // rather than walking up into whatever contains the temp dir.
  writeFileSync(path.join(cwd, "package.json"), "{}", "utf8");
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("runSessionStartHook", () => {
  it("re-injects the latest checkpoint on source=compact", async () => {
    seedCheckpoint();
    const output = await runSessionStartHook(reader({ source: "compact", cwd }), { cwd, home });
    const context = output.hookSpecificOutput?.additionalContext;
    expect(context).toBeTruthy();
    expect(context).toContain("src/alpha.ts");
    expect(context).toContain("wire the sessionstart hook");
  });

  it("carries NO permission decision — SessionStart has no tool call to decide about", async () => {
    seedCheckpoint();
    const output = await runSessionStartHook(reader({ source: "compact", cwd }), { cwd, home });
    expect(output.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it.each(["startup", "resume", "clear", undefined])(
    "emits nothing for source=%s (only a compact actually lost context)",
    async (source) => {
      seedCheckpoint();
      const output = await runSessionStartHook(
        reader({ source: source as string | undefined, cwd }),
        { cwd, home }
      );
      expect(output).toEqual({});
    }
  );

  it("emits nothing when there is no checkpoint, rather than a 'none found' note", async () => {
    // A "no checkpoint" note would be pure token cost for zero information.
    const output = await runSessionStartHook(reader({ source: "compact", cwd }), { cwd, home });
    expect(output).toEqual({});
  });

  it("respects handoff.enabled=false", async () => {
    seedCheckpoint();
    writeFileSync(
      path.join(cwd, "optiflow.config.json"),
      JSON.stringify({ handoff: { enabled: false } }),
      "utf8"
    );
    const output = await runSessionStartHook(reader({ source: "compact", cwd }), { cwd, home });
    expect(output).toEqual({});
  });

  it("fails open on unreadable input", async () => {
    expect(await runSessionStartHook(reader(null), { cwd, home })).toEqual({});
  });

  it("caps injected context well below the hook envelope cap", async () => {
    // Re-injection only pays for itself if it stays small; a checkpoint
    // that renders to 10K characters has stopped being a summary.
    seedCheckpoint({
      openFiles: Array.from({ length: 2000 }, (_, i) => `src/generated/file-${i}.ts`),
    } as never);
    const output = await runSessionStartHook(reader({ source: "compact", cwd }), { cwd, home });
    const context = output.hookSpecificOutput?.additionalContext ?? "";
    expect(context.length).toBeLessThanOrEqual(4_000);
    expect(context).toContain("chars omitted");
  });
});
