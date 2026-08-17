import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectUpstreamInvariant } from "./detect.js";

// Sandboxed scratch project mimicking vendor/token-optimizer-mcp/plugin/hooks/
// so this never touches (or depends on the current state of) the real
// vendored submodule — see scripts/verify-upstream-invariants.mjs for the
// standalone version of this same check, run against the real submodule.

let cwd: string;
let hooksDir: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "optiflow-upstream-invariant-test-"));
  writeFileSync(path.join(cwd, "optiflow.config.json"), "{}", "utf8");
  hooksDir = path.join(cwd, "vendor", "token-optimizer-mcp", "plugin", "hooks");
  mkdirSync(hooksDir, { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("detectUpstreamInvariant", () => {
  it("reports 'ok' when no hook source file mentions updatedInput", () => {
    writeFileSync(path.join(hooksDir, "pretooluse-router.mjs"), "export function route() { return {}; }\n", "utf8");
    const result = detectUpstreamInvariant({ cwd });
    expect(result.status).toBe("ok");
    expect(result.offendingFiles).toEqual([]);
  });

  it("reports 'violated' and names the offending file when updatedInput appears anywhere under plugin/hooks/", () => {
    writeFileSync(path.join(hooksDir, "pretooluse-router.mjs"), "return { hookSpecificOutput: { updatedInput: {} } };\n", "utf8");
    const result = detectUpstreamInvariant({ cwd });
    expect(result.status).toBe("violated");
    expect(result.offendingFiles).toHaveLength(1);
    expect(result.offendingFiles[0]).toMatch(/pretooluse-router\.mjs$/);
  });

  it("finds an offender nested in a subdirectory (e.g. plugin/hooks/lib/)", () => {
    const libDir = path.join(hooksDir, "lib");
    mkdirSync(libDir, { recursive: true });
    writeFileSync(path.join(libDir, "policy.mjs"), "// updatedInput\n", "utf8");
    const result = detectUpstreamInvariant({ cwd });
    expect(result.status).toBe("violated");
    expect(result.offendingFiles[0]).toMatch(/lib[\\/]policy\.mjs$/);
  });

  it("reports 'unknown' when the vendored hooks directory doesn't exist (submodule not initialized)", () => {
    rmSync(hooksDir, { recursive: true, force: true });
    const result = detectUpstreamInvariant({ cwd });
    expect(result.status).toBe("unknown");
  });
});
