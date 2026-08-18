// Default optiflow.config.json shape.
//
// chop.enabled defaults to `false` globally. This is a LOCKED decision (plan
// Risk R4 / Module 1's trust-boundary note: rewriting Bash `command` changes
// what the permission system matches against), not something a project
// config flips on merely by existing — a project must explicitly set
// `chop.enabled: true` to turn it on.
//
// v2 cleanup: `engines.tokenOptimizer`/`engines.headroom` (a version pin
// compared against a vendored submodule, an npx/PATH-binary invocation
// mode) removed — both upstreams are genuinely merged into this codebase
// now, not invoked as separate processes. See
// docs/ADR/0002-real-merge-not-orchestration.md.

export interface DefaultConfigShape {
  chop: {
    enabled: boolean;
    allowlist: string[];
    excludeCommands: string[];
    /**
     * Below this many raw output bytes, `wrapper.ts` skips filtering and
     * passes output through verbatim — compressing an already-small output
     * wastes CPU for no token savings and risks losing fidelity on output
     * that was never a context problem. Phase 3 addition (not present in
     * Phase 2): consumed by `src/chop/wrapper.ts` and
     * `src/chop/posttooluse-mcp.ts`, never by the `PreToolUse` rewrite
     * decision itself (`pretooluse.ts`), because output size is unknown
     * before the wrapped command has actually run.
     */
    minOutputBytes: number;
  };
  toon: {
    enabled: boolean;
    minSavingsPercent: number;
    /**
     * Phase 5 addition (not present in Phase 2/3), following the same
     * additive-config precedent as `chop.minOutputBytes`: below this many
     * rows (top-level JSON array elements, or CSV data rows), TOON
     * conversion isn't even attempted — tabular encoding's per-row overhead
     * (headers, structural markers) rarely pays off on a handful of rows,
     * and the measured-savings guard in `src/toon/guard.ts` would almost
     * always reject it anyway. This just skips the wasted encode+count work.
     */
    minRows: number;
  };
  statusline: {
    enabled: boolean;
    debounceMs: number;
  };
  handoff: {
    enabled: boolean;
    checkpointDir: string;
    /**
     * Phase 7 addition (not present in Phase 2/earlier phases), following
     * the same additive-config precedent as `chop.minOutputBytes`/
     * `toon.minRows`: the number of newest checkpoints (by in-file
     * `timestamp`, never filename or mtime order — see
     * `src/handoff/checkpoint.ts`'s `pruneCheckpoints`) to keep per
     * checkpoint directory; older ones are deleted after each write. `0`
     * means unlimited (never prune) — see the schema.ts comment on why this
     * is `.nonnegative()`, not `.positive()`.
     */
    keep: number;
  };
  report: {
    includeOptimizer: boolean;
  };
  telemetry: {
    enabled: boolean;
  };
  /**
   * Phase 4 addition (v2 plan, "Kompress ONNX port"), following the same
   * additive-config precedent as `chop.minOutputBytes`/`toon.minRows`/
   * `handoff.keep`. Opt-in and graceful-degrading by design (matches this
   * codebase's existing pattern for optional heavy dependencies): the
   * ~274MB ONNX model is never bundled and never downloaded implicitly —
   * both `enabled` and `allowDownload` default to `false`, so a project
   * that never mentions `kompress` in its config gets zero network access
   * and zero behavior change from this feature existing.
   */
  kompress: {
    enabled: boolean;
    /**
     * Must be explicitly `true` for `src/native/kompress-model.ts`'s
     * `ensureModelDownloaded` to fetch the model on a cache miss. A cache
     * miss with this `false` (the default) degrades gracefully instead of
     * downloading — see `src/native/kompress.ts`'s `compressWithKompress`.
     */
    allowDownload: boolean;
    /**
     * Which published ONNX artifact to use: `"int8"` (weight-only int8,
     * ~274MB — the default; see `kompress-model.ts`'s module doc comment
     * for the accuracy/size tradeoff this is based on) or `"fp32"` (~601MB
     * lossless reference).
     */
    variant: "int8" | "fp32";
  };
  /**
   * v2 Phase 5c addition ("wire the native compression modules in"), same
   * additive-config precedent as every other section here. Unlike
   * `kompress` (opt-in: downloads a ~274MB model on first use), SmartCrusher
   * has no comparable cost — it's a WASM module already bundled alongside
   * the rest of the plugin, with no network access and no meaningfully
   * different behavior/resource profile than TOON — so `enabled` defaults
   * to `true`, matching `toon.enabled`'s default rather than `kompress.enabled`'s.
   */
  smartCrusher: {
    enabled: boolean;
    /**
     * Minimum required (tokensBefore - tokensAfter) / tokensBefore percent
     * before `src/chop/filters/generic.ts` accepts a SmartCrusher-compressed
     * result over whatever it would otherwise do (TOON already declined, or
     * this is the generic non-uniform JSON path) — same mandatory
     * measured-savings-guard convention as `toon.minSavingsPercent`
     * (`src/toon/guard.ts`'s `evaluateGuard`, reused directly rather than
     * reimplemented). Set slightly below TOON's 30% default: by the time
     * SmartCrusher is tried, TOON has already declined, so this is a
     * fallback-of-a-fallback where a smaller real win is still worth taking
     * over the dumber truncation path it would otherwise compete with.
     */
    minSavingsPercent: number;
  };
}

export const DEFAULT_CONFIG: DefaultConfigShape = {
  chop: {
    enabled: false,
    allowlist: ["git", "docker", "kubectl", "npm", "terraform"],
    excludeCommands: ["npm run build", "npm test"],
    // Lowered from an initial 2000 during Phase 3 review: at 2000, a
    // routine `git status` (~840 bytes on this repo) never crossed the
    // floor, so Module 1 compressed nothing in its own default config,
    // defeating the module's purpose. 400 catches typical multi-line CLI
    // output (git status, docker ps, kubectl get) while still skipping
    // one-line/near-empty output where filtering has nothing to gain.
    minOutputBytes: 400,
  },
  toon: {
    enabled: true,
    minSavingsPercent: 30,
    minRows: 5,
  },
  statusline: {
    enabled: true,
    debounceMs: 300,
  },
  handoff: {
    enabled: true,
    checkpointDir: ".optiflow/checkpoints",
    // 20 is a rough "a few days of active work" proxy, same rough-heuristic
    // spirit as statusline's RECENT_SAVINGS_WINDOW_MS — not measured against
    // real usage data yet. Documented interaction to watch (docs/modules.md):
    // with `handoff.enabled: true`, every SessionEnd writes an auto-checkpoint
    // even when its decisions/nextSteps/openFiles are all empty, so on a
    // busy project auto-noise can evict older MANUAL checkpoints before a
    // user goes looking for them. Keep-newest-N is what the plan specs; a
    // priority/pinning scheme is a follow-up decision, not this phase's call.
    keep: 20,
  },
  report: {
    includeOptimizer: false,
  },
  telemetry: {
    enabled: false,
  },
  kompress: {
    enabled: false,
    allowDownload: false,
    variant: "int8",
  },
  smartCrusher: {
    enabled: true,
    minSavingsPercent: 20,
  },
};
