// Unit tests for `enforceVerdict`'s `denyWithSubstitute` support (Phase 2 of
// the plan: "deny-and-substitute"). `pretooluse.ts`'s fixture tests already
// cover the end-to-end wiring; this file isolates `enforceVerdict` itself —
// in particular the claim in its own doc comment that a substitute degrades
// EXACTLY like a plain deny does (off -> allow, advise/repeat -> a
// non-blocking allowWithContext that drops the substitute).

import { describe, expect, it } from "vitest";
import { MODE_ADVISE, MODE_ENFORCE, MODE_OFF, enforceVerdict, withEscape } from "./policy.js";

describe("enforceVerdict — denyWithSubstitute", () => {
  it("emits denyWithSubstitute when enforcing, not previously denied, and a substitute is supplied", () => {
    const verdict = enforceVerdict("file too large", false, MODE_ENFORCE, "// compressed skeleton");
    expect(verdict).toEqual({
      kind: "denyWithSubstitute",
      reason: withEscape("file too large"),
      substitute: "// compressed skeleton",
    });
  });

  it("falls back to plain deny when no substitute is supplied (existing callers, unchanged)", () => {
    const verdict = enforceVerdict("file too large", false, MODE_ENFORCE);
    expect(verdict).toEqual({ kind: "deny", reason: withEscape("file too large") });
  });

  it("falls back to plain deny when substitute is an empty string (falsy, treated as absent)", () => {
    const verdict = enforceVerdict("file too large", false, MODE_ENFORCE, "");
    expect(verdict).toEqual({ kind: "deny", reason: withEscape("file too large") });
  });

  it("MODE_OFF still allows outright even when a substitute is supplied", () => {
    const verdict = enforceVerdict("file too large", false, MODE_OFF, "// compressed skeleton");
    expect(verdict).toEqual({ kind: "allow" });
  });

  it("MODE_ADVISE degrades to a non-blocking allowWithContext, dropping the substitute", () => {
    const verdict = enforceVerdict("file too large", false, MODE_ADVISE, "// compressed skeleton");
    expect(verdict).toEqual({ kind: "allowWithContext", context: "file too large" });
  });

  it("a repeat (deniedBefore) degrades to a non-blocking allowWithContext, dropping the substitute", () => {
    const verdict = enforceVerdict("file too large", true, MODE_ENFORCE, "// compressed skeleton");
    expect(verdict).toEqual({ kind: "allowWithContext", context: "file too large" });
  });
});
