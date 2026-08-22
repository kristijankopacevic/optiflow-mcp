import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runUpdateCli, stripOptiflowAliases, TARBALL_URL } from "./update.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-update-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("TARBALL_URL", () => {
  it("is the remote tarball, never the github: shorthand", () => {
    // The `github:` form is what npm symlinks to a temp clone it then
    // deletes, producing "Cannot find module .../plugin/bin/optiflow".
    // Pinning this here so nobody "simplifies" it back.
    expect(TARBALL_URL.startsWith("https://")).toBe(true);
    expect(TARBALL_URL).not.toContain("github:");
    expect(TARBALL_URL).toContain(".tar.gz");
  });
});

describe("stripOptiflowAliases", () => {
  it("removes an alias line and leaves everything else intact", () => {
    writeFileSync(
      path.join(home, ".bashrc"),
      ["export PATH=/usr/bin:$PATH", "alias optiflow='node /old/path/bin/optiflow'", "alias ll='ls -la'"].join("\n"),
      "utf8"
    );

    const results = stripOptiflowAliases(home);
    expect(results).toHaveLength(1);
    expect(results[0].removedLines).toBe(1);

    const rest = readFileSync(path.join(home, ".bashrc"), "utf8");
    expect(rest).toContain("export PATH=/usr/bin:$PATH");
    expect(rest).toContain("alias ll='ls -la'");
    expect(rest).not.toContain("optiflow");
  });

  it("matches regardless of quoting and leading whitespace", () => {
    writeFileSync(
      path.join(home, ".zshrc"),
      ['  alias optiflow="node /a/b"', "alias optiflow=/c/d"].join("\n"),
      "utf8"
    );
    expect(stripOptiflowAliases(home)[0].removedLines).toBe(2);
  });

  it("does NOT touch an unrelated alias whose name merely contains optiflow", () => {
    const line = "alias optiflow-chop='node /x/y'";
    writeFileSync(path.join(home, ".bashrc"), line, "utf8");
    expect(stripOptiflowAliases(home)).toHaveLength(0);
    expect(readFileSync(path.join(home, ".bashrc"), "utf8")).toBe(line);
  });

  it("backs the file up before editing it", () => {
    // These files carry far more than our one alias; never edit one without
    // a copy the user can fall back to.
    const original = ["alias optiflow='node /old'", "export SOMETHING=important"].join("\n");
    writeFileSync(path.join(home, ".bashrc"), original, "utf8");
    stripOptiflowAliases(home);
    const backups = readdirSync(home).filter((f) => f.includes("optiflow-backup"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(path.join(home, backups[0]), "utf8")).toBe(original);
  });

  it("reports nothing when there is no alias, and skips absent rc files", () => {
    writeFileSync(path.join(home, ".bashrc"), "export EDITOR=vim", "utf8");
    expect(stripOptiflowAliases(home)).toEqual([]);
  });
});

describe("runUpdateCli", () => {
  it("uninstalls before installing, and installs the tarball", () => {
    const calls: string[][] = [];
    runUpdateCli({ home, runNpm: (args) => void calls.push(args) });

    expect(calls[0]).toEqual(["uninstall", "-g", "optiflow-mcp"]);
    expect(calls[1]).toEqual(["install", "-g", TARBALL_URL]);
  });

  it("still installs when the uninstall fails (nothing was installed)", () => {
    const calls: string[][] = [];
    runUpdateCli({
      home,
      runNpm: (args) => {
        calls.push(args);
        if (args[0] === "uninstall") throw new Error("not installed");
      },
    });
    expect(calls.map((c) => c[0])).toEqual(["uninstall", "install"]);
  });

  it("tells the user to unalias when it removed one, since it cannot do that itself", () => {
    writeFileSync(path.join(home, ".bashrc"), "alias optiflow='node /old'", "utf8");
    const out = runUpdateCli({ home, runNpm: () => {} }).join("\n");
    expect(out).toContain("unalias optiflow");
    expect(out).toContain("cannot remove");
  });

  it("stays quiet about aliases when there were none", () => {
    const out = runUpdateCli({ home, runNpm: () => {} }).join("\n");
    expect(out).not.toContain("unalias");
  });
});
