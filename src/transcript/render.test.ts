import { describe, expect, it } from "vitest";
import { analyze } from "./analyze.js";
import { renderJson, renderMarkdown, renderReport, renderTable } from "./render.js";
import type { TranscriptRecord } from "./parse.js";

function buildSampleResult() {
  const records: TranscriptRecord[] = [
    {
      type: "assistant",
      uuid: "t1",
      isSidechain: false,
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        id: "msg_1",
        role: "assistant",
        usage: {
          input_tokens: 5,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 0,
          output_tokens: 200,
          output_tokens_details: { thinking_tokens: 50 },
        },
      },
    },
    {
      type: "assistant",
      uuid: "t2",
      isSidechain: false,
      sessionId: "s1",
      timestamp: "2026-01-03T00:00:00.000Z",
      message: {
        id: "msg_2",
        role: "assistant",
        usage: {
          input_tokens: 5,
          cache_creation_input_tokens: 900,
          cache_read_input_tokens: 0,
          output_tokens: 90,
        },
      },
    },
  ];
  return analyze(records);
}

describe("renderJson", () => {
  it("produces valid, parseable JSON containing the key figures", () => {
    const result = buildSampleResult();
    const output = renderJson(result);
    const parsed = JSON.parse(output);
    expect(parsed.totals.totalTokens).toBe(result.totals.totalTokens);
    expect(parsed.cacheBreaks).toHaveLength(1);
  });
});

describe("renderTable", () => {
  it("contains the expected key figures in human-readable form", () => {
    const result = buildSampleResult();
    const output = renderTable(result);
    expect(output).toContain("optiflow report");
    expect(output).toContain(String(result.turnCount));
    expect(output).toContain("Cache breaks:\n");
    expect(output).toContain("msg_2"); // turnId (message.id) appears in the breaks table
  });

  it("omits section headers for empty sections (e.g. no subagents)", () => {
    const result = buildSampleResult();
    const output = renderTable(result);
    expect(output).not.toContain("Subagents");
  });
});

describe("renderMarkdown", () => {
  it("produces GFM-style tables containing the expected key figures", () => {
    const result = buildSampleResult();
    const output = renderMarkdown(result);
    expect(output).toContain("# optiflow report");
    expect(output).toContain("| sessionId | turns |");
    expect(output).toContain("s1");
    expect(output).toContain("## Cache breaks");
  });
});

describe("renderReport", () => {
  it("dispatches to the correct renderer per format, defaulting to table", () => {
    const result = buildSampleResult();
    expect(renderReport(result, "json")).toBe(renderJson(result));
    expect(renderReport(result, "markdown")).toBe(renderMarkdown(result));
    expect(renderReport(result, "table")).toBe(renderTable(result));
  });
});
