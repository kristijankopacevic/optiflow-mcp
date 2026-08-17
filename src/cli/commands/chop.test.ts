import { describe, expect, it } from "vitest";
import { runChopCli } from "./chop.js";

describe("runChopCli", () => {
  it("reports a clear error when no command is given", () => {
    const result = runChopCli([], 0);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/no command given/);
  });

  it("runs a real command and propagates its exit code and output", () => {
    const result = runChopCli(["git", "--version"], 0);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/git version/);
  });

  it("propagates a non-zero exit code from the wrapped command", () => {
    const result = runChopCli(["git", "not-a-real-subcommand"], 0);
    expect(result.exitCode).not.toBe(0);
  });
});
