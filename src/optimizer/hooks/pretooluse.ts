// The `PreToolUse` hook entry for the optimizer's enforcement layer
// (matcher `Read|Grep|Glob|Edit|MultiEdit|Write|Bash|PowerShell` — see
// `plugin/hooks/hooks.json`). Denies/redirects expensive built-in tool
// calls toward the merged `smart_*` MCP tools, exactly as vendor's own
// `pretooluse-router.mjs` does.
//
// Faithfully ported from
// `vendor/token-optimizer-mcp/plugin/hooks/pretooluse-router.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md), restructured to this
// repo's own hook shape (`src/chop/pretooluse.ts`, `src/handoff/
// precompact-hook.ts`): a decision function that never touches
// stdin/stdout/`process.exit`, plus a thin `main()` wrapper that does. Two
// consequences of that restructuring, both intentional:
//
//   1. Vendor's `allow()`/`deny()`/`advise()` call `process.exit()`
//      directly; `decidePreToolUse` below returns a `Promise<HookOutput>`
//      instead (see `lib/policy.ts`'s `Verdict`/`enforceVerdict`). It is
//      `async` so the deny/redirect path can `await` real (async) work
//      before answering — see that path's own comment below for what.
//   2. Vendor's bounded-execution guarantee ("beat the host's five-second
//      timeout and fail open deterministically", `lib/observability.mjs`'s
//      `beginHookInvocation` deadline) is reimplemented here as a
//      `Promise.race` in `main()` against `lib/observability.ts`'s
//      `hookDeadlineMs()`, rather than a `setTimeout` that exits the
//      process from inside a library module.
//
// BASH MATCHER OVERLAP WITH CHOP — resolved, not just wired. `src/chop/
// pretooluse.ts` also registers on `PreToolUse` with a matcher that
// includes `Bash`. The two cannot collide: this hook only ever emits some
// combination of `permissionDecision` (+`permissionDecisionReason`) and
// `additionalContext` — never `updatedInput` (see `lib/policy.ts`'s
// `Verdict`, including `denyWithSubstitute`, which emits deny + both
// fields together) — and chop's hook only ever emits
// `updatedInput` or a bare `{}` (`src/chop/pretooluse.ts`'s own header;
// confirmed against vendor's `policy.mjs`, which documents "the common
// path stays a bare `{}`" for its own no-opinion case) — disjoint fields,
// matching `docs/architecture.md`'s existing Authority Map line 43
// ("`Bash` `updatedInput` rewriting" is chop's alone; "verified unclaimed"
// there refers to exactly this router). If a call needs both a rewrite AND
// a deny, Claude Code's own hook-merge semantics apply `permissionDecision:
// "deny"` regardless of any `updatedInput` a co-registered hook proposed —
// the safer of the two possible orderings, and not a case this code has to
// arbitrate itself.
//
// CORE-VS-PERIPHERAL SCOPE OF THIS CHECKPOINT: the deny/redirect decision
// itself, session-state loop-breaking, the UCR guard, and the
// experiment-arm feature gates are ported at full fidelity. The
// just-in-time finding injection / zero-turn-refusal diff path
// (`lib/inject.ts`) and the mid-session runway forecast
// (`lib/surface.ts`) are checkpoint-2 stubs that always fall back to
// vendor's own already-documented fail-open behavior (see those files'
// headers) — this hook already denies/redirects exactly as vendor does;
// it just doesn't yet carry extra context alongside that decision.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  readHookInput,
  writeHookOutput,
  allow as hookAllow,
  deny as hookDeny,
  allowWithContext as hookAllowWithContext,
  denyWithSubstitute as hookDenyWithSubstitute,
  type HookOutput,
} from "../../core/hook-io.js";
import { appendLedger } from "../../core/ledger.js";
import { estimateTokens } from "../../core/tokens.js";
import {
  mode,
  MODE_OFF,
  MODE_ENFORCE,
  loadState,
  saveState,
  alreadyDenied,
  enforceVerdict,
  type Verdict,
} from "./lib/policy.js";
import {
  normalizePayload,
  decide,
  remember,
  readCostBytes,
  touchedFiles,
  isContentDump,
  commandProjectRoot,
  type NormalizedPayload,
} from "./lib/decide.js";
import { recordRead, fingerprint } from "./lib/metrics.js";
import { maybeSurface } from "./lib/surface.js";
import { recordingNudge, isSubstantive } from "./lib/recording.js";
import { wikiDir, load, harvest, projectRootFor, contentHash } from "./lib/wiki.js";
import {
  refusalPayload,
  substitutionFor,
  forTouch,
  forCommand,
  forSharedCommand,
  noteActClasses,
  forRepeatedAct,
} from "./lib/inject.js";
import { indexFile } from "./lib/staleness.js";
import { isArchived } from "./lib/transcript.js";
import { isFsSafePath } from "./lib/paths.js";
import { episodeMeta, featuresForArm } from "./lib/experiment.js";
import { optimizerToolsForHook, rememberOptimizerTools } from "./lib/capabilities.js";
import { evaluateUcrGuards } from "./lib/ucr-guard.js";
import { hookDeadlineMs } from "./lib/observability.js";
// NOT a static top-level import, deliberately. `code-compressor.ts` has its
// own static `import Parser from "web-tree-sitter"` (see that module's own
// header); a static import of it HERE would poison this hook's entire ESM
// module-graph resolution before the try/catch below ever runs, exactly the
// failure mode `esbuild.config.mjs`'s `nativeExternals` comment and
// `src/optimizer/core/token-counter.ts`'s header both document for risky
// optional deps — and this hook file's own `hookEntries` comment in
// `esbuild.config.mjs` specifically calls out staying lean. Deferred to a
// dynamic `import()` inside the try/catch (below) instead, so an absent/
// broken dependency degrades to the plain redirect, not a dead hook.

/** Ledger module name for the deny-and-substitute path (see `optiflow savings`). */
export const CODE_SUBSTITUTE_LEDGER_MODULE = "code-substitute";

/** Ledger module name for an unchanged re-read that was refused outright. */
export const READ_SUPPRESSED_LEDGER_MODULE = "read-suppressed";

/** Largest file the hook will read to index. Above this the touch is still observed, but not hashed. */
const HARVEST_MAX_BYTES = Number(process.env.TOKEN_OPTIMIZER_HARVEST_MAX_BYTES) || 4_000_000;

/**
 * Prepended to every `denyWithSubstitute` payload so the compressed text
 * never silently reads as the whole file — the model needs to know bodies
 * were elided and that `smart_read` (same path) returns the real contents.
 */
const SUBSTITUTE_PREFACE =
  "[optiflow: structure-preserving compression of this file -- imports/exports, " +
  "signatures, and types are kept verbatim, but most function/method bodies are " +
  "elided (see the inline \"lines omitted\" markers). Call the token-optimizer MCP " +
  "tool smart_read with the same path if you need the full, uncompressed contents.]";

export interface PreToolUseRawPayload {
  [key: string]: unknown;
}

/** Turns a `Verdict` into this repo's `HookOutput` shape (see module header on the `process.exit` restructuring). */
function verdictToHookOutput(verdict: Verdict): HookOutput {
  if (verdict.kind === "allow") return {};
  if (verdict.kind === "allowWithContext") return hookAllowWithContext("PreToolUse", verdict.context);
  if (verdict.kind === "denyWithSubstitute") {
    return hookDenyWithSubstitute("PreToolUse", verdict.reason, verdict.substitute);
  }
  return hookDeny("PreToolUse", verdict.reason);
}

/**
 * The decision function. Does real (fail-open, best-effort) filesystem I/O
 * — session state, the wiki graph — but never touches stdin/stdout or
 * `process.exit`, so it is directly unit-testable, matching this repo's
 * other hooks.
 */
export async function decidePreToolUse(raw: PreToolUseRawPayload | null): Promise<HookOutput> {
  if (!raw) return {};
  try {
    const currentMode = mode();
    if (currentMode === MODE_OFF) return {};

    const payload: NormalizedPayload = normalizePayload(raw);
    if (!payload.tool_name) return {};

    const features = featuresForArm();
    const episode = episodeMeta({ client: "claude-code", raw });

    // The AGENT, not just the session — see `lib/policy.ts`'s `statePath`.
    const agentScope = payload.transcript_path || null;
    const state = loadState(payload.session_id, agentScope);
    const toolEvidence = optimizerToolsForHook(raw, state);
    rememberOptimizerTools(state, toolEvidence);

    const ucrVerdict = evaluateUcrGuards(payload, touchedFiles(payload).map((item) => item.path));
    const verdict = ucrVerdict || (features.routing ? decide(payload, state, toolEvidence.names) : null);

    const dirFor = (path: string) => wikiDir(projectRootFor(path, payload.cwd) ?? payload.cwd);

    if (!verdict) {
      // ALLOWED PATH — builds the re-read index, records read cost, injects
      // prior findings, nudges recording, surfaces the runway forecast,
      // and captures a structural touch. Every sub-step below is wrapped
      // exactly where vendor wraps it, so a defect in one never costs the
      // user their tool call.
      remember(payload, state);
      saveState(payload.session_id, state, agentScope);

      const touched = touchedFiles(payload);

      const bytes = readCostBytes(payload);
      if (bytes && payload.tool_input.file_path) {
        recordRead(dirFor(payload.tool_input.file_path), {
          anchor: payload.tool_input.file_path,
          sessionId: payload.session_id,
          bytes,
          fp: fingerprint(payload.tool_input.file_path),
        });
      } else if (isContentDump(payload.tool_input.command)) {
        for (const { path, size } of touched) {
          if (size > 0) {
            recordRead(dirFor(path), {
              anchor: path,
              sessionId: payload.session_id,
              bytes: size,
              fp: fingerprint(path),
            });
          }
        }
      }

      let context: string | null = null;
      if (features.retrieval) {
        try {
          state.injected = state.injected || [];
          const alreadyInjected = new Set(state.injected);
          const before = alreadyInjected.size;
          const parts: string[] = [];
          let actsChanged = false;

          for (const { path } of touched) {
            const dir = dirFor(path);
            const note = forTouch(dir, load(dir), path, {
              sessionId: payload.session_id,
              alreadyInjected,
              episode,
            });
            if (note) parts.push(note);
          }

          const command = payload.tool_input?.command;
          if (command) {
            const root = commandProjectRoot(payload, payload.cwd);
            const dir = wikiDir(root ?? payload.cwd);
            const note = forCommand(dir, load(dir), command, {
              sessionId: payload.session_id,
              alreadyInjected,
              episode,
            });
            if (note) parts.push(note);

            const shared = forSharedCommand(dir, command, {
              sessionId: payload.session_id,
              alreadyInjected,
              projectRoot: root,
              episode,
            });
            if (shared) parts.push(shared);

            // `noteActClasses` always returns a `Set` (never `null`), so this
            // matches vendor's own `crossed !== null` check exactly.
            const crossed = noteActClasses(state, command);
            if (crossed !== null) actsChanged = true;
            const repeat = forRepeatedAct(dir, command, crossed, {
              sessionId: payload.session_id,
              projectRoot: root,
              episode,
            });
            if (repeat) parts.push(repeat);
          }

          if (alreadyInjected.size !== before || actsChanged) {
            state.injected = [...alreadyInjected];
            saveState(payload.session_id, state, agentScope);
          }
          if (parts.length) context = parts.join("\n\n");
        } catch {
          // Delivery is an optimization; a defect here must never cost the user their tool call.
        }
      }

      try {
        if (
          features.harvest &&
          toolEvidence.names.has("wiki_write") &&
          isSubstantive(payload.tool_name)
        ) {
          state.edits = (state.edits || 0) + 1;
          const edited = payload.tool_input?.file_path;
          if (edited) state.editedFiles = [edited, ...(state.editedFiles || [])].slice(0, 20);

          const nudge = recordingNudge(dirFor(edited || payload.cwd || process.cwd()), {
            state,
            edits: state.edits,
            files: state.editedFiles,
          });
          if (nudge) {
            state.recordingNudged = true;
            context = context ? `${context}\n\n${nudge}` : nudge;
          }
          saveState(payload.session_id, state, agentScope);
        }
      } catch {
        // Bookkeeping must never cost a tool call.
      }

      try {
        const surfaced = maybeSurface(dirFor(payload.cwd || process.cwd()), {
          state,
        });
        if (surfaced.state !== state.forecast) {
          state.forecast = surfaced.state;
          saveState(payload.session_id, state, agentScope);
        }
        if (surfaced.text) context = context ? `${context}\n\n${surfaced.text}` : surfaced.text;
      } catch {
        // A forecast is a courtesy and must never cost a tool call.
      }

      if (features.capture) {
        for (const { path, size } of touched) {
          try {
            if (isArchived(path)) continue;
            if (size > HARVEST_MAX_BYTES) continue;
            const dir = dirFor(path);
            if (!isFsSafePath(path)) continue;

            const source = readFileSync(path, "utf8");
            harvest(dir, {
              filePath: path,
              sessionId: payload.session_id,
              action: payload.tool_name ?? undefined,
              hash: contentHash(path, source),
            });
            indexFile(dir, path, source);
          } catch {
            // Never let bookkeeping break an allowed call.
          }
        }
      }

      return context ? hookAllowWithContext("PreToolUse", context) : {};
    }

    // DENY/REDIRECT PATH.
    const repeat = verdict.persistent ? false : alreadyDenied(state, verdict.key);
    // Before `remember`, which is about to mark this very call as seen —
    // what licenses a diff/"unchanged" claim is what the session held on
    // the way IN.
    const seenThisSession = Boolean(state.seen?.[payload.tool_input?.file_path ?? ""]);
    remember(payload, state);
    saveState(payload.session_id, state, agentScope);

    let reason = verdict.reason;
    let substitute: string | undefined;
    if (!repeat && payload.tool_name === "Read" && payload.tool_input.file_path) {
      try {
        const filePath = payload.tool_input.file_path;
        const dir = wikiDir(projectRootFor(filePath, payload.cwd) ?? payload.cwd);
        const graph = load(dir, { snapshots: true });
        const carried = refusalPayload(graph, filePath, { seenThisSession });
        if (carried) {
          reason = carried;
        } else {
          const source = readFileSync(filePath, "utf8");
          indexFile(dir, filePath, source);
          const substitution = substitutionFor(
            dir,
            load(dir),
            (payload.tool_input.raw_file_path as string | undefined) ?? filePath,
            source,
            {
              sessionId: payload.session_id,
              client: episode.client,
              clientVersion: episode.clientVersion,
              model: episode.model,
              modelVersion: episode.modelVersion,
            }
          );
          if (substitution) reason = substitution;

          // The higher-value substitution this phase adds: hand the model
          // the compressed content itself, inside the denial, instead of
          // just a pointer to smart_read (module header, "deny-and-
          // substitute"). Only offered when it clears the SAME real-
          // reduction gates smart-read.ts's own CodeCompressor branch uses
          // (smart-read.ts:282-299) -- a language CodeCompressor actually
          // recognizes, a result it genuinely modified, and a measured
          // reduction in both bytes and tokens, never an assumed one.
          // Bounded by HARVEST_MAX_BYTES, the same ceiling the allowed path
          // above already applies to in-hook reads, so this never runs AST
          // parsing over an arbitrarily large file. Gated on `MODE_ENFORCE`:
          // in `advise` mode (or a repeat, excluded above) `enforceVerdict`
          // always discards any substitute and returns `allowWithContext`,
          // so computing one would just be wasted AST work.
          if (currentMode === MODE_ENFORCE && Buffer.byteLength(source, "utf8") <= HARVEST_MAX_BYTES) {
            const { compressCode } = await import("../../native/code-compressor.js");
            const codeResult = await compressCode(source);
            if (
              codeResult.language !== "unknown" &&
              codeResult.wasModified &&
              codeResult.compressed.length < source.length &&
              codeResult.compressedTokens < codeResult.originalTokens
            ) {
              substitute = `${SUBSTITUTE_PREFACE}\n\n${codeResult.compressed}`;

              // Record the saving. Note this measures the substitute as
              // BUILT, not as delivered: `writeHookOutput`'s envelope cap
              // can still truncate it downstream, so a very large outline
              // is credited with slightly more than reached the model.
              // `compressCode` already produced real token counts here, so
              // unlike the byte-derived paths these two numbers are the
              // compressor's own — see `optiflow savings` for how the
              // report labels that.
              appendLedger({
                module: CODE_SUBSTITUTE_LEDGER_MODULE,
                command_or_context: filePath,
                tokensBefore: codeResult.originalTokens,
                tokensAfter: codeResult.compressedTokens,
                bytesBefore: Buffer.byteLength(source, "utf8"),
                bytesAfter: Buffer.byteLength(substitute, "utf8"),
              });
            }
          }
        }
      } catch (err) {
        if (process.env.OPTIFLOW_DEBUG_SUBSTITUTE) {
          console.error("[substitute-debug]", err instanceof Error ? err.stack : String(err));
        }
        // Any failure here falls back to the plain redirect, which always works.
      }
    }

    // On a repeat this degrades to a note and lets the call through, which
    // is what bounds the blast radius when the MCP server is unavailable.
    // `substitute` is undefined unless the block above actually produced a
    // real, measured reduction, so `enforceVerdict` falls back to a plain
    // `deny` exactly as before whenever it didn't.
    // An avoided read is a saving too, but a different KIND of saving from
    // compression, so it gets its own ledger module and is never folded into
    // the compression total (see src/cli/commands/savings.ts). Only recorded
    // when the refusal actually stands: on a repeat, `enforceVerdict`
    // downgrades to advisory and the read goes through, so nothing was saved.
    const suppressedBytes =
      "suppressedReadBytes" in verdict ? verdict.suppressedReadBytes : undefined;
    if (!repeat && currentMode === MODE_ENFORCE && suppressedBytes) {
      appendLedger({
        module: READ_SUPPRESSED_LEDGER_MODULE,
        command_or_context: payload.tool_input.file_path ?? "unknown",
        tokensBefore: estimateTokens(suppressedBytes),
        tokensAfter: 0,
        bytesBefore: suppressedBytes,
        bytesAfter: 0,
      });
    }

    return verdictToHookOutput(enforceVerdict(reason, repeat, currentMode, substitute));
  } catch {
    // Wrapped whole: any defect in this hook must cost the user nothing.
    return {};
  }
}

export async function runPreToolUse(
  readInput: () => Promise<PreToolUseRawPayload | null>
): Promise<HookOutput> {
  const raw = await readInput();
  return decidePreToolUse(raw);
}

// ---------------------------------------------------------------------------
// Process entry point (guarded), bounded by `hookDeadlineMs()` so a stalled
// stdin read or a pathological decision cannot hold the user's tool call
// past the host's own timeout — see module header.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const deadline = new Promise<HookOutput>((resolve) => {
    setTimeout(() => resolve({}), hookDeadlineMs()).unref?.();
  });
  const output = await Promise.race([
    runPreToolUse(() => readHookInput<PreToolUseRawPayload>()),
    deadline,
  ]);
  writeHookOutput(output);
}

const entryArg = process.argv[1];
const isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;

if (isDirectRun) {
  main();
}

// Re-exported so `hookAllow` isn't flagged unused if a future checkpoint
// needs an explicit allow with a logged reason (matches `hook-io.ts`'s own
// exported surface).
export { hookAllow };
