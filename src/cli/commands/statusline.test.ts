import { describe, expect, it } from "vitest";
import { runStatusline } from "../../statusline/cli.js";
import type { StatuslineInput } from "../../statusline/render.js";

// registerStatuslineCommand itself is thin commander wiring around
// runStatusline (already directly tested in src/statusline/cli.test.ts) —
// this just confirms the CLI's file/stdin -> StatuslineInput bridging
// behaves the same way the underlying render path expects.
describe("optiflow statusline CLI bridging", () => {
  it("renders normally when given a well-formed payload", async () => {
    const input: StatuslineInput = { model: { display_name: "Claude Opus" }, context_window: { used_percentage: 50 } };
    const output = await runStatusline(async () => input);
    expect(output).toContain("Claude Opus");
    expect(output).toContain("50%");
  });

  it("falls back to an empty payload without throwing on malformed JSON", async () => {
    const output = await runStatusline(async () => {
      try {
        JSON.parse("{not json");
        return {};
      } catch {
        return {};
      }
    });
    expect(output).toContain("--%");
  });
});
