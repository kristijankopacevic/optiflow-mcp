import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { putCcr } from "../../native/ccr-store.js";
import { runCcrRetrieveCli } from "./ccr-retrieve.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-ccr-retrieve-cli-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("runCcrRetrieveCli", () => {
  it("prints the stored original content for a hash that was actually stored", () => {
    putCcr("abc123def456", "the original full content that was dropped", { home });
    const result = runCcrRetrieveCli("abc123def456", { home });
    expect(result.found).toBe(true);
    expect(result.stdout).toBe("the original full content that was dropped");
    expect(result.stderr).toBe("");
  });

  it("reports a clear miss (not found) for a well-formed hash that was never stored", () => {
    const result = runCcrRetrieveCli("000000000000", { home });
    expect(result.found).toBe(false);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/no stored content found/);
  });

  it("rejects a malformed hash before ever touching the store", () => {
    const result = runCcrRetrieveCli("not-a-hash!", { home });
    expect(result.found).toBe(false);
    expect(result.stderr).toMatch(/doesn't look like a CCR marker hash/);
  });

  it("rejects a hash with the wrong length", () => {
    const result = runCcrRetrieveCli("abc123", { home });
    expect(result.found).toBe(false);
    expect(result.stderr).toMatch(/doesn't look like a CCR marker hash/);
  });

  it("rejects uppercase hex (markers are always lowercase)", () => {
    const result = runCcrRetrieveCli("ABC123DEF456", { home });
    expect(result.found).toBe(false);
    expect(result.stderr).toMatch(/doesn't look like a CCR marker hash/);
  });
});
