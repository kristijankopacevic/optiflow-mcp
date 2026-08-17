import { describe, expect, it, vi } from "vitest";
import type { RunResult } from "./win-spawn.js";
import { runWrapper } from "./wrapper-core.js";

function fakeRun(result: Partial<RunResult>) {
  return vi.fn(() => ({ status: 0, signal: null, stdout: "", stderr: "", ...result }));
}

describe("runWrapper — exit code propagation", () => {
  it("propagates a zero exit code", () => {
    const run = fakeRun({ status: 0, stdout: "ok\n" });
    const writeLedger = vi.fn();
    const result = runWrapper("git", ["status"], { run, writeLedger });
    expect(result.exitCode).toBe(0);
  });

  it("propagates a non-zero exit code", () => {
    const run = fakeRun({ status: 128, stdout: "", stderr: "fatal: not a git repository\n" });
    const writeLedger = vi.fn();
    const result = runWrapper("git", ["status"], { run, writeLedger });
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain("fatal: not a git repository");
  });

  it("maps a signal-terminated child to exit code 1 rather than crashing", () => {
    const run = fakeRun({ status: null, signal: "SIGTERM" });
    const writeLedger = vi.fn();
    const result = runWrapper("git", ["status"], { run, writeLedger });
    expect(result.exitCode).toBe(1);
  });

  it("reports a spawn failure as exit code 127 with a clear stderr message, never throwing", () => {
    const run = vi.fn(() => ({ status: null, signal: null, stdout: "", stderr: "", spawnError: "ENOENT" }));
    const writeLedger = vi.fn();
    const result = runWrapper("totally-missing-binary", [], { run, writeLedger });
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("totally-missing-binary");
    expect(writeLedger).not.toHaveBeenCalled();
  });
});

describe("runWrapper — filtering policy", () => {
  it("does NOT filter output on a non-zero exit code for a non-test-runner binary (diagnostic preservation)", () => {
    const raw = "error: pathspec 'x' did not match any file(s) known to git\n".repeat(50);
    const run = fakeRun({ status: 1, stdout: raw });
    const writeLedger = vi.fn();
    const result = runWrapper("git", ["checkout", "x"], { run, writeLedger, minOutputBytes: 10 });
    expect(result.stdout).toBe(raw);
  });

  it("filters output on a zero exit code once above minOutputBytes", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `log line ${i}`).join("\n");
    const run = fakeRun({ status: 0, stdout: raw });
    const writeLedger = vi.fn();
    const result = runWrapper("git", ["log"], { run, writeLedger, minOutputBytes: 10 });
    expect(result.stdout.length).toBeLessThan(raw.length);
  });

  it("does not bother filtering tiny output below minOutputBytes", () => {
    const raw = "On branch main\nnothing to commit, working tree clean\n";
    const run = fakeRun({ status: 0, stdout: raw });
    const writeLedger = vi.fn();
    const result = runWrapper("git", ["status"], { run, writeLedger, minOutputBytes: 10_000 });
    expect(result.stdout).toBe(raw);
  });

  it("filters test-runner output EVEN on a non-zero exit code (failure detail is the payload)", () => {
    const raw = ["FAIL src/a.test.ts", "PASS src/b.test.ts", "Tests: 1 failed, 1 passed, 2 total"].join("\n");
    const run = fakeRun({ status: 1, stdout: raw });
    const writeLedger = vi.fn();
    const result = runWrapper("jest", [], { run, writeLedger, minOutputBytes: 100_000 });
    expect(result.stdout).toContain("FAIL src/a.test.ts");
    expect(result.stdout).not.toContain("PASS src/b.test.ts");
  });

  it("never filters stderr", () => {
    const run = fakeRun({ status: 0, stdout: "ok\n", stderr: "npm warn deprecated x@1.0.0: y\n".repeat(50) });
    const writeLedger = vi.fn();
    const result = runWrapper("npm", ["install"], { run, writeLedger, minOutputBytes: 0 });
    expect(result.stderr).toBe("npm warn deprecated x@1.0.0: y\n".repeat(50));
  });
});

describe("runWrapper — ledger recording", () => {
  it("records tokensBefore/tokensAfter and bytesBefore/bytesAfter reflecting the actual shrink", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `log line ${i}`).join("\n");
    const run = fakeRun({ status: 0, stdout: raw });
    const writeLedger = vi.fn();
    runWrapper("git", ["log"], { run, writeLedger, minOutputBytes: 10 });

    expect(writeLedger).toHaveBeenCalledTimes(1);
    const record = writeLedger.mock.calls[0][0];
    expect(record.module).toBe("chop");
    expect(record.command_or_context).toBe("git log");
    expect(record.tokensAfter).toBeLessThan(record.tokensBefore);
    expect(record.bytesAfter).toBeLessThan(record.bytesBefore);
  });

  it("never writes a ledger entry when the command could not be spawned at all", () => {
    const run = vi.fn(() => ({ status: null, signal: null, stdout: "", stderr: "", spawnError: "ENOENT" }));
    const writeLedger = vi.fn();
    runWrapper("missing", [], { run, writeLedger });
    expect(writeLedger).not.toHaveBeenCalled();
  });
});

describe("runWrapper — real end-to-end spawn (no injected run(), exercises win-spawn.ts for real)", () => {
  it("runs a real git status and returns a zero exit code", () => {
    const writeLedger = vi.fn();
    const result = runWrapper("git", ["status"], { writeLedger, minOutputBytes: 0 });
    expect(result.exitCode).toBe(0);
    expect(writeLedger).toHaveBeenCalledTimes(1);
  });

  it("propagates a real non-zero git exit code (invalid subcommand)", () => {
    const writeLedger = vi.fn();
    const result = runWrapper("git", ["not-a-real-subcommand"], { writeLedger, minOutputBytes: 0 });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
