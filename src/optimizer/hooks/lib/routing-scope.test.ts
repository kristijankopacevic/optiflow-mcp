// Pins the scope decisions of the router: which built-in calls are worth a
// redirect at all. A redirect costs the model a full turn, so every rule
// here has to clear "the turn costs less than what it saves" — the two
// changes pinned below both came from live evidence that a rule failed that
// bar (a single-file grep redirect on a search-heavy session; an Edit
// redirect on a 133KB CSS file whose premise — "Edit echoes the file" — is
// false for Claude Code's actual Edit tool).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decide, type NormalizedPayload } from "./decide.js";
import type { SeenEntry } from "./policy.js";

let dir: string;
let filePath: string;

function payloadFor(tool: string, input: Record<string, unknown>): NormalizedPayload {
  return {
    session_id: "routing-scope-test",
    transcript_path: null,
    cwd: dir,
    tool_name: tool,
    tool_input: input,
  };
}

const freshState = (): { seen: Record<string, SeenEntry> } => ({ seen: {} });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "optiflow-routing-scope-"));
  filePath = path.join(dir, "big-enough.ts");
  writeFileSync(filePath, "export const x = 1;\n".repeat(2000), "utf8"); // ~40KB
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Grep scope gate", () => {
  it("allows a single-file grep — bounded output, a redirect would cost more than it saves", () => {
    const verdict = decide(payloadFor("Grep", { pattern: "foo", path: filePath }), freshState(), ["smart_grep"]);
    expect(verdict).toBeNull();
  });

  it("still redirects a directory-scoped grep", () => {
    const verdict = decide(payloadFor("Grep", { pattern: "foo", path: dir }), freshState(), ["smart_grep"]);
    expect(verdict?.redirectTool).toBe("smart_grep");
  });

  it("still redirects an unscoped grep", () => {
    const verdict = decide(payloadFor("Grep", { pattern: "foo" }), freshState(), ["smart_grep"]);
    expect(verdict?.redirectTool).toBe("smart_grep");
  });

  it("treats a nonexistent path as unscoped rather than as a file", () => {
    const verdict = decide(
      payloadFor("Grep", { pattern: "foo", path: path.join(dir, "no-such-dir") }),
      freshState(),
      ["smart_grep"]
    );
    expect(verdict).not.toBeNull();
  });
});

describe("removed Edit/Write redirects", () => {
  it("never challenges an Edit, regardless of file size", () => {
    // Claude Code's Edit takes old_string/new_string and returns a bounded
    // snippet — it does not echo the file, so the vendored redirect premise
    // was false and the rule burned a turn per large-file edit.
    const verdict = decide(
      payloadFor("Edit", { file_path: filePath, old_string: "a", new_string: "b" }),
      freshState(),
      ["smart_edit"]
    );
    expect(verdict).toBeNull();
  });

  it("never challenges a MultiEdit", () => {
    expect(
      decide(payloadFor("MultiEdit", { file_path: filePath }), freshState(), ["smart_edit"])
    ).toBeNull();
  });

  it("never challenges a Write, regardless of content size", () => {
    const verdict = decide(
      payloadFor("Write", { file_path: filePath, content: "x".repeat(100_000) }),
      freshState(),
      ["smart_write"]
    );
    expect(verdict).toBeNull();
  });
});
