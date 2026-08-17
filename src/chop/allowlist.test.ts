import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { getAllowlistDecision, isExcluded } from "./allowlist.js";

const config = {
  allowlist: DEFAULT_CONFIG.chop.allowlist,
  excludeCommands: DEFAULT_CONFIG.chop.excludeCommands,
};

describe("isExcluded", () => {
  it("matches an exact excludeCommands entry", () => {
    expect(isExcluded("npm test", ["npm test"])).toBe(true);
  });

  it("does not match a different command", () => {
    expect(isExcluded("npm install", ["npm test"])).toBe(false);
  });

  it("is forgiving of incidental whitespace differences", () => {
    expect(isExcluded("npm   test", ["npm test"])).toBe(true);
    expect(isExcluded("  npm test  ", ["npm test"])).toBe(true);
  });

  it("does not substring-match — 'npm test' does not exclude 'npm test:unit'", () => {
    expect(isExcluded("npm test:unit", ["npm test"])).toBe(false);
  });
});

describe("getAllowlistDecision", () => {
  it("allows git (default allowlist)", () => {
    const result = getAllowlistDecision("git status", config);
    expect(result).toEqual({ eligible: true, binary: "git", reason: expect.any(String) });
  });

  it("allows docker/kubectl/npm/terraform (default allowlist)", () => {
    for (const cmd of ["docker ps", "kubectl get pods", "npm install", "terraform plan"]) {
      expect(getAllowlistDecision(cmd, config).eligible).toBe(true);
    }
  });

  it("allows built-in test runners jest/vitest/pytest even though not in the default allowlist", () => {
    for (const cmd of ["jest --coverage", "vitest run", "pytest -q"]) {
      const result = getAllowlistDecision(cmd, config);
      expect(result.eligible).toBe(true);
      expect(result.reason).toContain("test runner");
    }
  });

  it("allows 'go test' but not other 'go' subcommands", () => {
    expect(getAllowlistDecision("go test ./...", config).eligible).toBe(true);
    expect(getAllowlistDecision("go build ./...", config).eligible).toBe(false);
    expect(getAllowlistDecision("go", config).eligible).toBe(false);
  });

  it("rejects a binary not on the allowlist and not a test runner", () => {
    const result = getAllowlistDecision("curl https://example.com", config);
    expect(result.eligible).toBe(false);
    expect(result.binary).toBe("curl");
  });

  it("excludeCommands takes precedence over an otherwise-eligible binary", () => {
    const result = getAllowlistDecision("npm test", config);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("excludeCommands");
  });

  it("excludeCommands precedence also applies to 'npm run build'", () => {
    expect(getAllowlistDecision("npm run build", config).eligible).toBe(false);
  });

  it("a command with no tokens is not eligible", () => {
    expect(getAllowlistDecision("", config).eligible).toBe(false);
  });
});
