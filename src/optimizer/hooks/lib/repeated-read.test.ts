// Covers the repeated-read suppression rule and, just as importantly, the
// `seen` state-shape migration it required.
//
// `SessionState.seen` was `Record<string, boolean>` and is now
// `Record<string, SeenEntry>`. State files live in a temp dir and outlive a
// plugin upgrade, so on the first run after this ships, every currently
// active session hands `loadState` a map full of `true`. Getting that wrong
// breaks enforcement for those sessions silently -- the router would read
// `.hash` off a boolean and take the wrong branch -- so the migration is
// pinned here directly rather than left implied by the feature tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decide, remember, type NormalizedPayload } from "./decide.js";
import { loadState, normalizeSeen, saveState, type SeenEntry } from "./policy.js";

let dir: string;
let filePath: string;

/** Comfortably over `refusalFloorBytes()` (1,024) so the read is in scope at all. */
const BODY = "export const value = 1;\n".repeat(200);

function payloadFor(file: string, extra: Record<string, unknown> = {}): NormalizedPayload {
  return {
    session_id: "repeated-read-test",
    transcript_path: null,
    cwd: dir,
    tool_name: "Read",
    tool_input: { file_path: file, ...extra },
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "optiflow-repeated-read-"));
  filePath = path.join(dir, "module.ts");
  writeFileSync(filePath, BODY, "utf8");
  delete process.env.TOKEN_OPTIMIZER_SUPPRESS_REPEAT_READS;
  delete process.env.TOKEN_OPTIMIZER_REPEAT_READ_WINDOW_MINUTES;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TOKEN_OPTIMIZER_SUPPRESS_REPEAT_READS;
  delete process.env.TOKEN_OPTIMIZER_REPEAT_READ_WINDOW_MINUTES;
});

describe("normalizeSeen — migration off the old boolean shape", () => {
  it("turns a legacy `true` into a hashless entry", () => {
    expect(normalizeSeen({ "/a.ts": true })).toEqual({ "/a.ts": { hash: "", at: 0 } });
  });

  it("keeps a current entry intact", () => {
    const entry = { hash: "abc", at: 1234 };
    expect(normalizeSeen({ "/a.ts": entry })).toEqual({ "/a.ts": entry });
  });

  it("repairs a partial entry rather than propagating undefined", () => {
    expect(normalizeSeen({ "/a.ts": { hash: 7, at: "soon" } })).toEqual({ "/a.ts": { hash: "", at: 0 } });
  });

  it("drops values it cannot interpret, and survives non-object input", () => {
    expect(normalizeSeen({ "/a.ts": false, "/b.ts": null, "/c.ts": "x" })).toEqual({});
    expect(normalizeSeen(null)).toEqual({});
    expect(normalizeSeen(["/a.ts"])).toEqual({});
  });

  it("a migrated entry never suppresses — it degrades to the old redirect", () => {
    const state = { seen: normalizeSeen({ [filePath]: true }) };
    const verdict = decide(payloadFor(filePath), state, ["smart_read"]);
    expect(verdict?.reason).toContain("smart_read");
    expect(verdict?.reason).not.toContain("has not changed");
  });
});

describe("loadState — the real upgrade path, off disk", () => {
  // normalizeSeen is unit-tested above, but the failure this migration
  // guards against is a state file written by the PREVIOUS version sitting
  // in the temp dir of a session that is running right now. That file is
  // read by loadState, not by normalizeSeen directly, so the upgrade path
  // is pinned here end to end rather than only at the function that
  // implements it.
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "optiflow-state-migration-"));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  function writeLegacyStateFile(sessionId: string, contents: unknown): void {
    writeFileSync(path.join(stateDir, `${sessionId}.json`), JSON.stringify(contents), "utf8");
  }

  it("reads a pre-upgrade state file without throwing, migrating `seen`", () => {
    writeLegacyStateFile("legacy", { seen: { "/a.ts": true, "/b.ts": true }, denied: { "read:/a.ts": true } });

    const state = loadState("legacy", null, { TOKEN_OPTIMIZER_STATE_DIR: stateDir } as NodeJS.ProcessEnv);

    expect(state.seen["/a.ts"]).toEqual({ hash: "", at: 0 });
    expect(state.seen["/b.ts"]).toEqual({ hash: "", at: 0 });
    // The rest of the state must survive the migration untouched.
    expect(state.denied["read:/a.ts"]).toBe(true);
  });

  it("round-trips a mixed-shape merge through saveState without corrupting either entry", () => {
    // saveState merges `{...current.seen, ...state.seen}` and does NOT
    // re-normalize, so a legacy entry read off disk and a new entry written
    // in this process end up side by side in one file.
    const env = { TOKEN_OPTIMIZER_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
    writeLegacyStateFile("mixed", { seen: { "/old.ts": true } });

    const state = loadState("mixed", null, env);
    state.seen["/new.ts"] = { hash: "deadbeef", at: 1_000 };
    expect(saveState("mixed", state, null, env)).toBe(true);

    const reloaded = loadState("mixed", null, env);
    expect(reloaded.seen["/old.ts"]).toEqual({ hash: "", at: 0 });
    expect(reloaded.seen["/new.ts"]).toEqual({ hash: "deadbeef", at: 1_000 });
  });
});

describe("repeated-read suppression", () => {
  it("refuses an unchanged re-read outright, with no second round trip", () => {
    const state: { seen: Record<string, SeenEntry> } = { seen: {} };
    remember(payloadFor(filePath), state);

    const verdict = decide(payloadFor(filePath), state, ["smart_read"]);
    expect(verdict).not.toBeNull();
    expect(verdict?.reason).toContain("has not changed");
    // The point of the rule: it does NOT send the model to another tool.
    expect(verdict?.reason).not.toContain("smart_read");
  });

  it("falls back to the smart_read redirect once the file actually changes", () => {
    const state: { seen: Record<string, SeenEntry> } = { seen: {} };
    remember(payloadFor(filePath), state);
    writeFileSync(filePath, BODY + "\nexport const added = 2;\n", "utf8");

    const verdict = decide(payloadFor(filePath), state, ["smart_read"]);
    expect(verdict?.reason).toContain("smart_read");
    expect(verdict?.reason).not.toContain("has not changed");
  });

  it("never blocks a ranged read, changed or not", () => {
    const state: { seen: Record<string, SeenEntry> } = { seen: {} };
    remember(payloadFor(filePath), state);

    expect(decide(payloadFor(filePath, { offset: 40 }), state, ["smart_read"])).toBeNull();
    expect(decide(payloadFor(filePath, { limit: 20 }), state, ["smart_read"])).toBeNull();
  });

  it("stops suppressing once the window has elapsed", () => {
    const state: { seen: Record<string, SeenEntry> } = { seen: {} };
    remember(payloadFor(filePath), state);
    // Backdate the recorded read past the default 30-minute window.
    state.seen[filePath] = { ...state.seen[filePath], at: Date.now() - 31 * 60_000 };

    const verdict = decide(payloadFor(filePath), state, ["smart_read"]);
    expect(verdict?.reason).toContain("smart_read");
  });

  it("honors a widened window", () => {
    const state: { seen: Record<string, SeenEntry> } = { seen: {} };
    remember(payloadFor(filePath), state);
    state.seen[filePath] = { ...state.seen[filePath], at: Date.now() - 31 * 60_000 };

    process.env.TOKEN_OPTIMIZER_REPEAT_READ_WINDOW_MINUTES = "120";
    expect(decide(payloadFor(filePath), state, ["smart_read"])?.reason).toContain("has not changed");
  });

  it("can be switched off, leaving the previous redirect behaviour", () => {
    const state: { seen: Record<string, SeenEntry> } = { seen: {} };
    remember(payloadFor(filePath), state);

    process.env.TOKEN_OPTIMIZER_SUPPRESS_REPEAT_READS = "0";
    expect(decide(payloadFor(filePath), state, ["smart_read"])?.reason).toContain("smart_read");
  });

  it("records a hashless entry for a file it cannot read, and so cannot suppress it", () => {
    const state: { seen: Record<string, SeenEntry> } = { seen: {} };
    const missing = path.join(dir, "vanished.ts");
    remember(payloadFor(missing), state);
    expect(state.seen[missing].hash).toBe("");
  });

  it("does not fire for a file the session has never read", () => {
    const other = path.join(dir, "other.ts");
    writeFileSync(other, BODY, "utf8");
    const state: { seen: Record<string, SeenEntry> } = { seen: {} };
    remember(payloadFor(filePath), state);

    // `other.ts` is under the large-file threshold and unseen, so nothing
    // in the Read branch applies to it.
    expect(decide(payloadFor(other), state, ["smart_read"])).toBeNull();
  });
});
