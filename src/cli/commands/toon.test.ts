import { describe, expect, it } from "vitest";
import type { ToonConfig } from "../../toon/index.js";
import { runToonCli } from "./toon.js";

const ENABLED: ToonConfig = { enabled: true, minSavingsPercent: 30, minRows: 5 };

describe("runToonCli", () => {
  it("prints the converted TOON output plus a savings message when the guard approves", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}`, active: i % 2 === 0 }));
    const input = JSON.stringify(items);
    const result = runToonCli(input, ENABLED);
    expect(result.converted).toBe(true);
    expect(result.stdout).not.toBe(`${input}\n`);
    expect(result.stderr).toMatch(/converted \(json\): \d+ -> \d+ tokens \(\d+\.\d% saved\)/);
  });

  it("prints the original input plus a clear skip reason when the guard rejects", () => {
    const input = JSON.stringify([{ id: 1, name: "a" }, { id: 2, name: "b" }]); // below minRows
    const result = runToonCli(input, ENABLED);
    expect(result.converted).toBe(false);
    expect(result.stdout).toBe(`${input}\n`);
    expect(result.stderr).toMatch(/^\[optiflow toon\] skipped: /);
    expect(result.stderr).toMatch(/minRows/);
  });

  it("prints the original untouched when toon is disabled", () => {
    const input = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}` })));
    const result = runToonCli(input, { ...ENABLED, enabled: false });
    expect(result.converted).toBe(false);
    expect(result.stdout).toBe(`${input}\n`);
    expect(result.stderr).toMatch(/enabled is false/);
  });
});
