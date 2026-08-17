// Shared types for the per-command-family output filters
// (git/docker/kubectl/npm/terraform/testrunner/generic).
//
// A filter's job: take the raw captured stdout/stderr of a command this
// module already decided was safe to rewrite and ran, and return a
// compressed/summarized version that preserves the information an agent
// actually needs — not a generic byte-cap truncation.

export interface FilterInput {
  /** Raw captured stdout of the wrapped command. */
  stdout: string;
  /** Raw captured stderr of the wrapped command. */
  stderr: string;
  /** The wrapped command's own argv, excluding the binary itself (argv[0]). */
  args: string[];
  /** The wrapped command's real exit code. */
  exitCode: number;
}

/**
 * A structural hint a later phase can use to decide whether TOON conversion
 * applies (Module 5 / Phase 5 — NOT implemented here, this is deliberately
 * just an extension point per the plan). `generic.ts` is the only filter
 * that currently sets `uniform-json-array`.
 */
export type FormatHint = "uniform-json-array" | "table" | "log" | "json" | "plain";

export interface FilterOutput {
  /** The compressed text to substitute for the raw output. */
  text: string;
  /** Structural shape hint; see `FormatHint`. */
  formatHint: FormatHint;
  /** Free-form counts/notes a caller may want to log (never required). */
  meta?: Record<string, unknown>;
}

export type OutputFilter = (input: FilterInput) => FilterOutput;
