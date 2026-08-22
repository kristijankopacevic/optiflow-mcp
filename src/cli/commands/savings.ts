// `optiflow savings` — what optiflow actually saved, as opposed to what a
// session spent.
//
// This exists because the plugin could not answer its own headline question.
// `optiflow report` reads Claude Code's transcripts and shows CONSUMPTION;
// it has no before/after and does not know optiflow exists. The ledger has
// before/after, but until now only `src/chop/wrapper-core.ts` ever wrote to
// it — and chop is off by default — so on a normal install the ledger was
// empty and a user asking "is this thing working?" had nothing to look at.
//
// MEASUREMENT HONESTY IS THE POINT OF THIS FILE, not a caveat bolted onto
// it. Three things are deliberately not smoothed over:
//
//   1. Token counts differ in quality by source. `code-substitute` rows
//      carry the compressor's own real token counts. Every other module
//      counts via `src/core/tokens.ts`, which uses `tiktoken` when it is
//      installed and otherwise falls back to chars/4 — an approximation
//      that skews badly on code and JSON. The output says which applies
//      instead of printing one confident number.
//   2. THERE ARE THREE DIFFERENT KINDS OF CLAIM here, and they are never
//      summed. Compression measures "this output was N tokens, it is now M".
//      `read-suppressed` measures "this read did not happen", which is only
//      a real saving if the model did not immediately work around it.
//      `redirect` measures "this went through a cheaper route" — and a
//      redirect is NOT free, since the replacement tool still returns
//      something, so its saving is the difference and can even be negative.
//      Each gets its own line; only compression is in the headline total.
//   3. Bytes are measured; tokens are derived. Where they disagree, bytes
//      are the more trustworthy number.

import type { Command } from "commander";
import { readLedger, type LedgerRecord } from "../../core/ledger.js";

/** Rows whose savings are directly comparable and safe to total together. */
const COMPRESSION_MODULES = new Set(["chop", "mcp-compression", "code-substitute"]);

/** Rows that measure an avoided read rather than a compressed payload. */
const AVOIDED_MODULE = "read-suppressed";

/**
 * Rows where the router refused a built-in call, named a replacement, and
 * the model actually called it. A third distinct claim: not "this output
 * shrank" and not "this never happened", but "this went through a cheaper
 * route". Kept out of the compression total for the same reason as
 * `read-suppressed` -- summing different claims overstates all of them.
 */
const REDIRECT_MODULE = "redirect";

export interface ModuleSummary {
  module: string;
  calls: number;
  tokensBefore: number;
  tokensAfter: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface SavingsSummary {
  modules: ModuleSummary[];
  /** Totals across `COMPRESSION_MODULES` only — see the header, point 2. */
  compression: ModuleSummary;
  /** Avoided-read rows, reported separately and never folded into the total. */
  avoided: ModuleSummary | null;
  /** Complied-with redirects, likewise reported on their own terms. */
  redirected: ModuleSummary | null;
  totalCalls: number;
}

function emptySummary(module: string): ModuleSummary {
  return { module, calls: 0, tokensBefore: 0, tokensAfter: 0, bytesBefore: 0, bytesAfter: 0 };
}

function accumulate(into: ModuleSummary, record: LedgerRecord): void {
  into.calls += 1;
  into.tokensBefore += Number(record.tokensBefore) || 0;
  into.tokensAfter += Number(record.tokensAfter) || 0;
  into.bytesBefore += Number(record.bytesBefore) || 0;
  into.bytesAfter += Number(record.bytesAfter) || 0;
}

/** Pure core: turns ledger rows into the shape the renderer prints. */
export function summarizeSavings(records: LedgerRecord[]): SavingsSummary {
  const byModule = new Map<string, ModuleSummary>();
  const compression = emptySummary("compression total");
  let avoided: ModuleSummary | null = null;
  let redirected: ModuleSummary | null = null;

  for (const record of records) {
    const module = String(record.module || "unknown");
    let summary = byModule.get(module);
    if (!summary) {
      summary = emptySummary(module);
      byModule.set(module, summary);
    }
    accumulate(summary, record);

    if (module === AVOIDED_MODULE) {
      avoided = avoided ?? emptySummary(AVOIDED_MODULE);
      accumulate(avoided, record);
    } else if (module === REDIRECT_MODULE) {
      redirected = redirected ?? emptySummary(REDIRECT_MODULE);
      accumulate(redirected, record);
    } else if (COMPRESSION_MODULES.has(module)) {
      accumulate(compression, record);
    }
  }

  return {
    modules: [...byModule.values()].sort((a, b) => b.tokensBefore - a.tokensBefore),
    compression,
    avoided,
    redirected,
    totalCalls: records.length,
  };
}

function pct(before: number, after: number): string {
  if (before <= 0) return "—";
  return `${(100 - (after / before) * 100).toFixed(1)}%`;
}

const n = (value: number): string => value.toLocaleString("en-US");

export interface RenderSavingsOptions {
  /** Whether an exact tokenizer was loaded; changes how tokens are labelled. */
  exactTokens: boolean;
  rangeLabel: string;
}

export function renderSavings(summary: SavingsSummary, options: RenderSavingsOptions): string {
  const lines: string[] = [];
  lines.push(`optiflow savings (${options.rangeLabel})`);

  if (summary.totalCalls === 0) {
    lines.push("");
    lines.push("  No savings recorded yet.");
    lines.push("");
    lines.push("  This is what an idle ledger looks like, not an error. It fills up as");
    lines.push("  optiflow compresses real tool output. If it stays empty while you work,");
    lines.push("  check `optiflow doctor` and see docs/enabling-everything.md.");
    return lines.join("\n");
  }

  const rows = summary.modules.map((m) => ({
    module: m.module,
    calls: n(m.calls),
    before: n(m.tokensBefore),
    after: n(m.tokensAfter),
    saved: n(Math.max(0, m.tokensBefore - m.tokensAfter)),
    cut: pct(m.tokensBefore, m.tokensAfter),
  }));

  const width = (key: keyof (typeof rows)[0], header: string) =>
    Math.max(header.length, ...rows.map((r) => r[key].length));
  const w = {
    module: width("module", "module"),
    calls: width("calls", "calls"),
    before: width("before", "tokens before"),
    after: width("after", "tokens after"),
    saved: width("saved", "saved"),
    cut: width("cut", "cut"),
  };

  lines.push("");
  lines.push(
    `  ${"module".padEnd(w.module)}  ${"calls".padStart(w.calls)}  ` +
      `${"tokens before".padStart(w.before)}  ${"tokens after".padStart(w.after)}  ` +
      `${"saved".padStart(w.saved)}  ${"cut".padStart(w.cut)}`
  );
  lines.push(
    `  ${"-".repeat(w.module)}  ${"-".repeat(w.calls)}  ${"-".repeat(w.before)}  ` +
      `${"-".repeat(w.after)}  ${"-".repeat(w.saved)}  ${"-".repeat(w.cut)}`
  );
  for (const r of rows) {
    lines.push(
      `  ${r.module.padEnd(w.module)}  ${r.calls.padStart(w.calls)}  ` +
        `${r.before.padStart(w.before)}  ${r.after.padStart(w.after)}  ` +
        `${r.saved.padStart(w.saved)}  ${r.cut.padStart(w.cut)}`
    );
  }

  const c = summary.compression;
  const savedTokens = Math.max(0, c.tokensBefore - c.tokensAfter);
  const savedBytes = Math.max(0, c.bytesBefore - c.bytesAfter);

  lines.push("");
  lines.push(`  Compression: ${n(c.calls)} calls, ${n(savedTokens)} tokens saved (${pct(c.tokensBefore, c.tokensAfter)} smaller)`);
  lines.push(`               ${n(savedBytes)} bytes saved (${pct(c.bytesBefore, c.bytesAfter)}) — measured, not derived`);

  if (summary.redirected) {
    const r = summary.redirected;
    const saved = r.tokensBefore - r.tokensAfter;
    lines.push("");
    lines.push(
      `  Redirects taken: ${n(r.calls)}, ~${n(saved)} tokens saved (${pct(r.tokensBefore, r.tokensAfter)})`
    );
    lines.push("               A redirect is not free — the replacement tool still returns");
    lines.push("               something — so this is the difference, not the whole file.");
    if (saved < 0) {
      lines.push("               NEGATIVE: the replacements returned MORE than the originals.");
    }
  }

  if (summary.avoided) {
    const a = summary.avoided;
    lines.push("");
    lines.push(`  Reads suppressed: ${n(a.calls)}, ~${n(a.tokensBefore)} tokens not sent`);
    lines.push("               Counted separately: this is content that was never read,");
    lines.push("               which only helps if the model did not work around the refusal.");
  }

  lines.push("");
  lines.push(
    options.exactTokens
      ? "  Token counts are exact (tiktoken loaded)."
      : "  Token counts are ESTIMATES (chars/4) — tiktoken is not installed, so treat"
  );
  if (!options.exactTokens) {
    lines.push("  the byte figures above as the reliable ones. `npm i -g tiktoken` for exact counts.");
  }

  return lines.join("\n");
}

function rangeToSince(range: string | undefined): { since?: Date; label: string } {
  if (!range || range === "all") return { label: "all time" };
  const match = /^(\d+)([hd])$/.exec(range);
  if (!match) return { label: "all time" };
  const amount = Number(match[1]);
  const ms = match[2] === "h" ? amount * 3_600_000 : amount * 86_400_000;
  return { since: new Date(Date.now() - ms), label: `last ${range}` };
}

export interface RunSavingsOptions {
  range?: string;
  json?: boolean;
  home?: string;
  exactTokens?: boolean;
}

/** Pure-ish core, directly testable — no process.argv, no real stdout. */
export function runSavingsCli(options: RunSavingsOptions = {}): string {
  const { since, label } = rangeToSince(options.range);
  const records = readLedger(since, { home: options.home });
  const summary = summarizeSavings(records);

  if (options.json) return JSON.stringify(summary, null, 2);

  return renderSavings(summary, {
    exactTokens: options.exactTokens === true,
    rangeLabel: label,
  });
}

export function registerSavingsCommand(program: Command): void {
  program
    .command("savings")
    .description(
      "What optiflow actually saved (before/after per compression), as opposed to " +
        "`optiflow report`, which shows what a session spent."
    )
    .option("--range <range>", 'limit to a window: "24h", "7d", or "all"', "all")
    .option("--json", "emit the raw summary as JSON")
    .option("--watch [seconds]", "re-render every N seconds (default 5) until interrupted")
    .action(async (options: { range?: string; json?: boolean; watch?: string | boolean }) => {
      // Loading the tokenizer is what makes the counts exact; it is optional
      // and absent on Node 18, hence the honest label rather than a silent
      // downgrade.
      const { initTokenizer } = await import("../../core/tokens.js");
      const exactTokens = await initTokenizer();

      const render = () => runSavingsCli({ range: options.range, json: options.json, exactTokens });

      if (!options.watch) {
        process.stdout.write(render() + "\n");
        return;
      }

      const seconds = Math.max(1, Number(options.watch === true ? 5 : options.watch) || 5);
      const tick = () => {
        // Clear screen + home cursor, the same thing `watch(1)` does. Kept
        // to ANSI rather than a dependency.
        process.stdout.write("\x1b[2J\x1b[H");
        process.stdout.write(render() + "\n");
        process.stdout.write(`\n  refreshing every ${seconds}s — Ctrl-C to stop\n`);
      };
      tick();
      const timer = setInterval(tick, seconds * 1000);
      const stop = () => {
        clearInterval(timer);
        process.stdout.write("\n");
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
}
