// Default optiflow.config.json shape.
//
// engines.tokenOptimizer.version is pinned to 5.7.0 — this is the REAL
// version found in vendor/token-optimizer-mcp/package.json at the time this
// was written, not the plan text's "5.7.0" taken on faith. (`git submodule
// status` reports the submodule's checked-out commit as
// `v2.12.1-201-g0c3e21a`, which is a stale `git describe` tag artifact — 201
// commits past an old `v2.12.1` tag that was never moved forward — not the
// package's actual semver. The package.json `version` field, 5.7.0, is the
// authoritative value and happens to match what the plan already assumed.)
//
// chop.enabled defaults to `false` globally. This is a LOCKED decision (plan
// Risk R4 / Module 1's trust-boundary note: rewriting Bash `command` changes
// what the permission system matches against), not something a project
// config flips on merely by existing — a project must explicitly set
// `chop.enabled: true` to turn it on.

export interface DefaultConfigShape {
  engines: {
    tokenOptimizer: {
      mode: "npx" | "disabled";
      package: string;
      version: string;
    };
    headroom: {
      mode: "path" | "disabled";
      binary: string;
      enabled: boolean;
    };
  };
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
}

export const DEFAULT_CONFIG: DefaultConfigShape = {
  engines: {
    tokenOptimizer: {
      mode: "npx",
      package: "@ooples/token-optimizer-mcp",
      version: "5.7.0",
    },
    headroom: {
      mode: "path",
      binary: "headroom",
      enabled: true,
    },
  },
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
};
