import { describe, expect, it } from "vitest";
import { quoteWindowsArg, runCommand } from "./win-spawn.js";

describe("quoteWindowsArg", () => {
  it("leaves a simple argument unquoted", () => {
    expect(quoteWindowsArg("status")).toBe("status");
    expect(quoteWindowsArg("--coverage")).toBe("--coverage");
  });

  it("quotes an argument containing a space", () => {
    expect(quoteWindowsArg("hello world")).toBe('"hello world"');
  });

  it("escapes an embedded double quote", () => {
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("doubles a trailing backslash before the closing quote", () => {
    expect(quoteWindowsArg("C:\\path with space\\")).toBe('"C:\\path with space\\\\"');
  });

  it("quotes an empty string", () => {
    expect(quoteWindowsArg("")).toBe('""');
  });
});

// These tests exercise the REAL spawn path on this machine (this phase's
// target platform is Windows) rather than mocking child_process, because
// the entire point of win-spawn.ts is a Windows-specific empirical
// workaround — a mock would just assert the mock's own behavior.
describe("runCommand — real process spawning", () => {
  it("captures stdout and a zero exit code for a successful command", () => {
    const result = runCommand("node", ["-e", "console.log('hello from child')"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("hello from child");
    expect(result.spawnError).toBeUndefined();
  });

  it("propagates a non-zero exit code", () => {
    const result = runCommand("node", ["-e", "process.exit(3)"]);
    expect(result.status).toBe(3);
  });

  it("preserves an argument containing a space end-to-end", () => {
    const result = runCommand("node", [
      "-e",
      "console.log(JSON.stringify(process.argv.slice(1)))",
      "hello world",
      "second arg",
    ]);
    expect(result.status).toBe(0);
    const argv = JSON.parse(result.stdout.trim());
    expect(argv).toEqual(["hello world", "second arg"]);
  });

  it("preserves an argument containing an embedded double quote end-to-end", () => {
    const result = runCommand("node", [
      "-e",
      "console.log(JSON.stringify(process.argv.slice(1)))",
      'say "hi" now',
    ]);
    expect(result.status).toBe(0);
    const argv = JSON.parse(result.stdout.trim());
    expect(argv).toEqual(['say "hi" now']);
  });

  it("never throws for a genuinely missing binary, and surfaces failure one way or another", () => {
    // On this platform, a bare missing-binary name is ambiguous at the
    // direct-spawn layer (Windows returns ENOENT for both "needs a shell"
    // .cmd files AND truly-missing binaries), so this falls back to the
    // shell path, where cmd.exe itself runs successfully and reports
    // "not recognized" via a normal non-zero exit code + stderr — not a
    // `spawnError`. Either shape is an acceptable failure signal as long as
    // it never throws and never reports success.
    const result = runCommand("optiflow-definitely-not-a-real-binary-xyz", []);
    const failedViaSpawnError = result.status === null && Boolean(result.spawnError);
    const failedViaNonZeroExit = result.status !== null && result.status !== 0;
    expect(failedViaSpawnError || failedViaNonZeroExit).toBe(true);
  });

  it("runs npm (a .cmd shim on Windows) via the shell fallback and captures its version", () => {
    const result = runCommand("npm", ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("propagates npm's non-zero exit code and stderr on a bad subcommand", () => {
    const result = runCommand("npm", ["run", "definitely-not-a-real-script-xyz"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("preserves a quoted argument with spaces through the npm .cmd shell fallback", () => {
    const result = runCommand("npm", ["exec", "--", "node", "-e", "console.log(process.argv[1])", "hello world"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("hello world");
  });
});
