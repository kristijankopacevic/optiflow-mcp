import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { putCcr } from "./ccr-store.js";
import { CCR_RETRIEVE_TOOL_DEFINITION, runCcrRetrieveTool } from "./ccr-tool.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-ccr-tool-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("ccr_retrieve tool definition", () => {
  it("declares the name the marker annotation tells the model to call", () => {
    // These two strings must agree or the hint in
    // src/chop/filters/generic.ts's `annotateCcrMarkers` sends the model to
    // a tool that doesn't exist.
    expect(CCR_RETRIEVE_TOOL_DEFINITION.name).toBe("ccr_retrieve");
  });

  it("requires the hash argument", () => {
    expect(CCR_RETRIEVE_TOOL_DEFINITION.inputSchema.required).toEqual(["hash"]);
  });
});

describe("runCcrRetrieveTool", () => {
  it("returns stored content verbatim", () => {
    putCcr("a1b2c3d4e5f6", '{"rows":[{"id":1}]}', { home });
    const result = runCcrRetrieveTool({ hash: "a1b2c3d4e5f6" }, { home });
    expect(result.found).toBe(true);
    expect(result.text).toBe('{"rows":[{"id":1}]}');
  });

  it("tolerates surrounding whitespace on the hash", () => {
    putCcr("a1b2c3d4e5f6", "content", { home });
    expect(runCcrRetrieveTool({ hash: "  a1b2c3d4e5f6\n" }, { home }).found).toBe(true);
  });

  it("explains how to extract the hash when given a whole marker", () => {
    // The likeliest model mistake: pasting the marker rather than the hash.
    const result = runCcrRetrieveTool({ hash: "<<ccr:a1b2c3d4e5f6 42_rows_offloaded>>" }, { home });
    expect(result.found).toBe(false);
    expect(result.text).toContain("12 lowercase hex characters");
  });

  it("reports a miss without throwing", () => {
    const result = runCcrRetrieveTool({ hash: "ffffffffffff" }, { home });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No stored content");
  });

  it("handles a missing/non-string hash argument", () => {
    expect(runCcrRetrieveTool({}, { home }).found).toBe(false);
    expect(runCcrRetrieveTool({ hash: 42 }, { home }).found).toBe(false);
  });

  it("rejects an uppercase hash rather than silently missing", () => {
    putCcr("a1b2c3d4e5f6", "content", { home });
    const result = runCcrRetrieveTool({ hash: "A1B2C3D4E5F6" }, { home });
    expect(result.found).toBe(false);
    expect(result.text).toContain("lowercase");
  });
});
