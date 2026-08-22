import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendLedger } from "../../core/ledger.js";
import { runSavingsCli, summarizeSavings, renderSavings } from "./savings.js";
import type { LedgerRecord } from "../../core/ledger.js";

let home: string;

function record(overrides: Partial<LedgerRecord>): LedgerRecord {
  return {
    timestamp: new Date().toISOString(),
    module: "mcp-compression",
    command_or_context: "mcp__x__y",
    tokensBefore: 1000,
    tokensAfter: 300,
    bytesBefore: 4000,
    bytesAfter: 1200,
    ...overrides,
  };
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-savings-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("summarizeSavings", () => {
  it("totals compression modules together", () => {
    const summary = summarizeSavings([
      record({ module: "mcp-compression" }),
      record({ module: "code-substitute", tokensBefore: 500, tokensAfter: 100 }),
      record({ module: "chop", tokensBefore: 200, tokensAfter: 50 }),
    ]);
    expect(summary.compression.calls).toBe(3);
    expect(summary.compression.tokensBefore).toBe(1700);
    expect(summary.compression.tokensAfter).toBe(450);
  });

  it("keeps read-suppressed OUT of the compression total", () => {
    // The central honesty property of this command: "output shrank" and
    // "the read never happened" are different claims and must not be added
    // together, or both are overstated.
    const summary = summarizeSavings([
      record({ module: "mcp-compression" }),
      record({ module: "read-suppressed", tokensBefore: 99_999, tokensAfter: 0 }),
    ]);
    expect(summary.compression.calls).toBe(1);
    expect(summary.compression.tokensBefore).toBe(1000);
    expect(summary.avoided?.calls).toBe(1);
    expect(summary.avoided?.tokensBefore).toBe(99_999);
  });

  it("still lists an unknown module without counting it as compression", () => {
    const summary = summarizeSavings([record({ module: "something-new" })]);
    expect(summary.modules.map((m) => m.module)).toContain("something-new");
    expect(summary.compression.calls).toBe(0);
  });

  it("tolerates malformed numeric fields", () => {
    const summary = summarizeSavings([
      record({ tokensBefore: NaN as unknown as number, bytesAfter: undefined as unknown as number }),
    ]);
    expect(Number.isFinite(summary.compression.tokensBefore)).toBe(true);
    expect(Number.isFinite(summary.compression.bytesAfter)).toBe(true);
  });
});

describe("renderSavings", () => {
  it("labels estimated token counts as estimates", () => {
    const out = renderSavings(summarizeSavings([record({})]), {
      exactTokens: false,
      rangeLabel: "all time",
    });
    expect(out).toContain("ESTIMATES");
    expect(out).toContain("byte figures above as the reliable ones");
  });

  it("says counts are exact when a real tokenizer was loaded", () => {
    const out = renderSavings(summarizeSavings([record({})]), {
      exactTokens: true,
      rangeLabel: "all time",
    });
    expect(out).toContain("exact (tiktoken loaded)");
    expect(out).not.toContain("ESTIMATES");
  });

  it("explains an empty ledger rather than printing a bare zero", () => {
    const out = renderSavings(summarizeSavings([]), { exactTokens: false, rangeLabel: "all time" });
    expect(out).toContain("No savings recorded yet");
    expect(out).toContain("not an error");
  });

  it("reports suppressed reads on their own line with a caveat", () => {
    const out = renderSavings(
      summarizeSavings([record({ module: "read-suppressed", tokensBefore: 4000, tokensAfter: 0 })]),
      { exactTokens: true, rangeLabel: "all time" }
    );
    expect(out).toContain("Reads suppressed");
    expect(out).toContain("work around the refusal");
  });
});

describe("runSavingsCli", () => {
  it("reads real ledger rows off disk", () => {
    appendLedger(record({ module: "code-substitute" }), { home });
    const out = runSavingsCli({ home, exactTokens: true });
    expect(out).toContain("code-substitute");
    expect(out).toContain("700"); // 1000 - 300 tokens saved
  });

  it("emits JSON when asked", () => {
    appendLedger(record({}), { home });
    const parsed = JSON.parse(runSavingsCli({ home, json: true }));
    expect(parsed.compression.calls).toBe(1);
  });

  it("honors a range window", () => {
    appendLedger(record({ timestamp: new Date(Date.now() - 48 * 3_600_000).toISOString() }), { home });
    const parsed = JSON.parse(runSavingsCli({ home, json: true, range: "24h" }));
    expect(parsed.totalCalls).toBe(0);
  });
});

describe("redirects — the third claim type", () => {
  it("keeps redirects out of the compression total", () => {
    const summary = summarizeSavings([
      record({ module: "mcp-compression" }),
      record({ module: "redirect", tokensBefore: 8000, tokensAfter: 600 }),
    ]);
    expect(summary.compression.calls).toBe(1);
    expect(summary.compression.tokensBefore).toBe(1000);
    expect(summary.redirected?.calls).toBe(1);
    expect(summary.redirected?.tokensBefore).toBe(8000);
  });

  it("says a redirect is not free, so the figure is a difference", () => {
    const out = renderSavings(
      summarizeSavings([record({ module: "redirect", tokensBefore: 8000, tokensAfter: 600 })]),
      { exactTokens: true, rangeLabel: "all time" }
    );
    expect(out).toContain("Redirects taken");
    expect(out).toContain("not free");
  });

  it("reports a NEGATIVE redirect saving rather than hiding it", () => {
    // A replacement that returns more than the original would have is a real
    // outcome and the report has to be able to say so; clamping it to zero
    // would make the tool look incapable of ever losing.
    const out = renderSavings(
      summarizeSavings([record({ module: "redirect", tokensBefore: 100, tokensAfter: 900 })]),
      { exactTokens: true, rangeLabel: "all time" }
    );
    expect(out).toContain("NEGATIVE");
  });

  it("totals redirect rows across calls", () => {
    const summary = summarizeSavings([
      record({ module: "redirect", tokensBefore: 5000, tokensAfter: 400 }),
      record({ module: "redirect", tokensBefore: 3000, tokensAfter: 200 }),
    ]);
    expect(summary.redirected?.calls).toBe(2);
    expect(summary.redirected?.tokensBefore).toBe(8000);
    expect(summary.redirected?.tokensAfter).toBe(600);
  });
});
