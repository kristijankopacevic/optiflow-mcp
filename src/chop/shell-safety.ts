// THE CORRECTNESS CORE of Module 1 (see plan Risk R4). Decides whether a
// Bash command string is safe to rewrite by prepending `optiflow-chop `.
//
// DESIGN DECISION (documented per the plan's explicit request): this module
// implements approach (a), a CONSERVATIVE character-class rejection, not a
// real shell-token-aware parser (approach (b)).
//
// The rule: reject the command (refuse to rewrite) if it contains ANY of
//   && || ; | > < $( ) ` & \n
// — treated as a character class, not a substring/`.includes()` scan, so
// `&&` and `||` are caught by their component characters (`&`, `|`) and
// `$(` / `)` by `$`, `(`, `)` individually. This module goes slightly beyond
// the plan's literal list in two ways, both making rejection MORE aggressive
// (never less):
//   - bare `(` / `)` are rejected even without a preceding `$` (a bare
//     subshell/group `(cd src && npm test)` is just as dangerous as `$(...)`
//     for this purpose, and the plan's own example for `$(...)` only makes
//     sense if `)` alone is already in the reject set).
//   - `\r` is rejected alongside `\n` (CRLF line endings on Windows must not
//     smuggle a second statement past a naive `\n`-only check).
//
// WHY CONSERVATIVE, NOT A REAL PARSER: distinguishing a metacharacter that is
// "inert" because it sits inside a quoted string (e.g. `git commit -m "foo
// && bar"`) from one that is a real shell operator requires a correct
// shell-grammar-aware tokenizer (handling nested quotes, escaping, `$'...'`,
// here-strings, etc.). Getting that subtly wrong in either direction is far
// worse here than in an ordinary CLI tool: `command` rewriting changes what
// Claude Code's *permission system* matches against (plan Risk R4). A false
// POSITIVE (deciding something is safe when it isn't) could silently change
// the meaning of a compound command a user/agent believed they were running
// unmodified. A false NEGATIVE (refusing to rewrite something that was
// actually safe) only costs a missed compression opportunity — the command
// still runs normally, unmodified, exactly as-is. That asymmetry is exactly
// why this module always resolves ambiguity toward "do not rewrite".
//
// CONCRETE CONSEQUENCE: `git commit -m "foo && bar"` is REJECTED (not
// rewritten) under this design, even though the `&&` is inert inside the
// quoted string and a real parser could prove it's a single simple command.
// This is an intentional, documented false negative, not a bug — see above.
export const FORBIDDEN_SHELL_CHARS = /[;&|<>$`()\n\r]/;

export interface ShellSafetyResult {
  /** True only if `command` is provably a single simple command. */
  safe: boolean;
  /** Present when `safe` is false: a human-readable reason for logs/tests. */
  reason?: string;
}

/**
 * Decides whether `command` is safe to rewrite by prepending
 * `optiflow-chop `. See module header for the full design rationale.
 */
export function isSingleSimpleCommand(command: unknown): ShellSafetyResult {
  if (typeof command !== "string") {
    return { safe: false, reason: "command is not a string" };
  }
  if (command.trim().length === 0) {
    return { safe: false, reason: "command is empty or whitespace-only" };
  }
  const match = command.match(FORBIDDEN_SHELL_CHARS);
  if (match) {
    return {
      safe: false,
      reason: `contains shell metacharacter '${match[0] === "\n" ? "\\n" : match[0] === "\r" ? "\\r" : match[0]}' — conservative character-class rejection (not shell-aware parsing; a metacharacter inside quotes is still rejected, see module doc)`,
    };
  }
  return { safe: true };
}

/**
 * Splits an already-safety-checked command into whitespace-separated words,
 * honoring single/double quotes as grouping (but NOT shell escaping rules
 * beyond that — this is intentionally simple because by the time this runs,
 * `isSingleSimpleCommand` has already guaranteed there is no shell
 * metacharacter that a real tokenizer would need to worry about; this exists
 * only so `allowlist.ts` can read the first one or two words (the binary
 * name, and — for `go test` — the subcommand) without a shell dependency.
 *
 * NOT used for spawning: `wrapper.ts` receives its argv directly from the
 * OS/shell that actually invoked `optiflow-chop <command>`, which already
 * did real, correct quote handling. This function is only for the
 * allowlist's read-only classification of the command string.
 */
export function splitWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) words.push(current);
  return words;
}
