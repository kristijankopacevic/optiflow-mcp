import { describe, expect, it } from "vitest";
import { isSingleSimpleCommand, splitWords } from "./shell-safety.js";

describe("isSingleSimpleCommand — positive cases (single simple commands)", () => {
  it.each([
    "git status",
    "docker ps",
    "kubectl get pods",
    "npm install",
    "terraform plan",
    "git log",
    "git diff --stat",
  ])("allows %s", (command) => {
    expect(isSingleSimpleCommand(command)).toEqual({ safe: true });
  });

  it("allows a command starting with an allowlisted binary but empty otherwise (bare 'git')", () => {
    expect(isSingleSimpleCommand("git")).toEqual({ safe: true });
  });
});

describe("isSingleSimpleCommand — negative cases (compound / unsafe commands)", () => {
  it("rejects a compound command joined with &&", () => {
    const result = isSingleSimpleCommand("cd src && npm test");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("&");
  });

  it("rejects a piped command", () => {
    const result = isSingleSimpleCommand("git log | head -20");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("|");
  });

  it("rejects output redirection", () => {
    const result = isSingleSimpleCommand("git status > out.txt");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain(">");
  });

  it("rejects command substitution via backticks", () => {
    const result = isSingleSimpleCommand("echo `date`");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("`");
  });

  it("rejects command substitution via $()", () => {
    const result = isSingleSimpleCommand("echo $(date)");
    expect(result.safe).toBe(false);
  });

  it("rejects a bare subshell/group even without a preceding $ (beyond the plan's literal $() case, documented conservative extension)", () => {
    const result = isSingleSimpleCommand("git log (test)");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("(");
  });

  it("rejects a semicolon-separated sequence", () => {
    const result = isSingleSimpleCommand("git status; echo done");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain(";");
  });

  it("rejects a backgrounded command", () => {
    const result = isSingleSimpleCommand("npm start &");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("&");
  });

  it("rejects an embedded newline", () => {
    const result = isSingleSimpleCommand("git status\nrm -rf /");
    expect(result.safe).toBe(false);
  });

  it("rejects an embedded carriage return (CRLF smuggling on Windows)", () => {
    const result = isSingleSimpleCommand("git status\r\nrm -rf /");
    expect(result.safe).toBe(false);
  });

  it(
    'DESIGN DECISION: rejects `git commit -m "foo && bar"` even though the && is inert inside ' +
      "quotes — conservative approach (a) intentionally cannot distinguish quoted-inert " +
      "metacharacters from real shell operators without a real tokenizer, and a false " +
      "negative (missed optimization) is the safe failure mode for this trust boundary " +
      "(see module header doc / plan Risk R4).",
    () => {
      const result = isSingleSimpleCommand('git commit -m "foo && bar"');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("conservative character-class rejection");
    }
  );

  it("rejects an empty string", () => {
    expect(isSingleSimpleCommand("").safe).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isSingleSimpleCommand("   \t  ").safe).toBe(false);
  });

  it("rejects a non-string value without throwing", () => {
    expect(isSingleSimpleCommand(undefined as unknown as string).safe).toBe(false);
    expect(isSingleSimpleCommand(null as unknown as string).safe).toBe(false);
    expect(isSingleSimpleCommand(42 as unknown as string).safe).toBe(false);
  });

  it("rejects redirection with <", () => {
    expect(isSingleSimpleCommand("docker exec -i mycontainer sh < script.sh").safe).toBe(false);
  });
});

describe("splitWords", () => {
  it("splits a simple space-separated command", () => {
    expect(splitWords("git status")).toEqual(["git", "status"]);
  });

  it("keeps a double-quoted argument as a single word", () => {
    expect(splitWords('git commit -m "hello world"')).toEqual([
      "git",
      "commit",
      "-m",
      "hello world",
    ]);
  });

  it("keeps a single-quoted argument as a single word", () => {
    expect(splitWords("git commit -m 'hello world'")).toEqual([
      "git",
      "commit",
      "-m",
      "hello world",
    ]);
  });

  it("collapses repeated whitespace between words", () => {
    expect(splitWords("git    status")).toEqual(["git", "status"]);
  });

  it("returns an empty array for an empty/whitespace-only command", () => {
    expect(splitWords("")).toEqual([]);
    expect(splitWords("   ")).toEqual([]);
  });

  it("supports go test's two-token form", () => {
    expect(splitWords("go test ./...")).toEqual(["go", "test", "./..."]);
  });
});
