import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHookInput } from "../core/hook-io.js";
import { runPostToolUseMcp } from "./posttooluse-mcp.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures/hooks/", import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function stdinFrom(text: string): NodeJS.ReadableStream {
  return Readable.from([text]) as unknown as NodeJS.ReadableStream;
}

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "optiflow-posttooluse-fixtures-project-"));
  homeDir = mkdtempSync(path.join(tmpdir(), "optiflow-posttooluse-fixtures-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe("posttooluse-mcp golden fixture", () => {
  it("chop.enabled: false (default) -> no updatedMCPToolOutput", async () => {
    const raw = loadFixture("posttooluse-mcp-large-json.json");
    const output = await runPostToolUseMcp(() => readHookInput(stdinFrom(raw)), { cwd: projectDir, home: homeDir });
    expect(output).toEqual({});
  });

  it("chop.enabled: true + low minOutputBytes -> updatedMCPToolOutput compresses the large uniform array", async () => {
    writeFileSync(
      path.join(projectDir, "optiflow.config.json"),
      JSON.stringify({ chop: { enabled: true, minOutputBytes: 50 } }),
      "utf8"
    );
    const raw = loadFixture("posttooluse-mcp-large-json.json");
    const output = await runPostToolUseMcp(() => readHookInput(stdinFrom(raw)), { cwd: projectDir, home: homeDir });
    const content = output.hookSpecificOutput?.updatedMCPToolOutput?.content as Array<{ type: string; text: string }>;
    expect(content).toBeDefined();
    expect(content[0].text).toContain("omitted");
    expect(content[0].text.length).toBeLessThan(raw.length);
  });
});
