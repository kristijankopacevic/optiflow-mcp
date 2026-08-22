// `ccr_retrieve` — the MCP surface over the CCR store.
//
// This closes the last gap that made lossy compression unsafe in practice.
// SmartCrusher drops rows/blobs and leaves a `<<ccr:HASH ...>>` marker;
// `src/chop/filters/generic.ts` persists the dropped content under that
// hash; but until now the ONLY way to read it back was
// `optiflow ccr-retrieve <hash>` on the command line. A model that hit a
// marker mid-task could not resolve it without being told to shell out --
// so "lossy but retrievable" was really just "lossy" from the model's point
// of view. `src/cli/commands/ccr-retrieve.ts`'s header flagged this exact
// follow-up as a deliberate scope boundary; this is that follow-up.
//
// Deliberately NOT under `src/optimizer/tools/`: everything there is
// vendored from token-optimizer-mcp (the 76 `smart_*`/analytics tools).
// This is optiflow's own tool, and keeping it out of that tree keeps the
// provenance count honest -- 76 vendored + 1 native.
//
// The validation and messages here are intentionally separate from the
// CLI's: the CLI writes to a human's terminal, this writes into a model's
// context, so a miss must explain what to do next rather than just report
// failure.

import { getCcr } from "./ccr-store.js";

/** SmartCrusher mints 12 lowercase hex characters — see `smart-crusher.ts`'s `CCR_MARKER_RE`. */
const HASH_RE = /^[0-9a-f]{12}$/;

export const CCR_RETRIEVE_TOOL_DEFINITION = {
  name: "ccr_retrieve",
  description:
    "Retrieve the original, uncompressed content behind a <<ccr:HASH ...>> marker. " +
    "Optiflow's compression replaces dropped rows or blobs with such a marker; call this " +
    "with the marker's 12-character hex hash to get the full content back.",
  annotations: {
    title: "Retrieve compressed-away content",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      hash: {
        type: "string",
        description:
          "The 12-character lowercase hex hash from a <<ccr:HASH ...>> marker (the HASH part only).",
      },
    },
    required: ["hash"],
  },
} as const;

export interface CcrRetrieveToolResult {
  found: boolean;
  /** Exactly what should be handed to the model — the content on a hit, an explanation on a miss. */
  text: string;
}

/**
 * Pure core of the `ccr_retrieve` tool. Never throws: `getCcr` already
 * swallows its own read errors, and a retrieval problem must degrade to a
 * readable message rather than an MCP error, which the model can do nothing
 * useful with.
 */
export function runCcrRetrieveTool(
  args: Record<string, unknown>,
  options: { home?: string } = {}
): CcrRetrieveToolResult {
  const hash = typeof args.hash === "string" ? args.hash.trim() : "";

  if (!HASH_RE.test(hash)) {
    return {
      found: false,
      text:
        `"${hash}" is not a CCR marker hash. Pass only the 12 lowercase hex characters ` +
        `immediately after "<<ccr:" — for example, from the marker ` +
        `"<<ccr:a1b2c3d4e5f6 42_rows_offloaded>>", pass "a1b2c3d4e5f6".`,
    };
  }

  const content = getCcr(hash, options);
  if (content === undefined) {
    return {
      found: false,
      text:
        `No stored content for CCR hash "${hash}". The marker may predate this session's ` +
        `store, or the store may have been cleared. Re-run whatever produced the marker, ` +
        `or read the underlying source directly.`,
    };
  }

  return { found: true, text: content };
}
