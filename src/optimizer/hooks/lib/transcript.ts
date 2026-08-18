// The never-transmit privacy guard: is this path inside the transcript
// archive?
//
// Only `isArchived` is reachable from the two hooks this tree ports (the
// rest of vendor's `transcript.mjs` — `archive`/`prune`/`readArchive` — is
// written/read by hook entry points this phase does not port: `stop.mjs`'s
// Stop-hook archival and the lesson extractor). Ported verbatim, and
// MUST stay in lockstep with `wiki.ts`'s `wikiDir()` default — see that
// file's path-convention note. Faithfully ported from
// `vendor/token-optimizer-mcp/plugin/hooks/lib/transcript.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md).

/** True when a path is inside a transcript archive — the never-transmit test. */
export function isArchived(path: unknown): boolean {
  return /[\\/]\.token-optimizer[\\/]wiki[\\/]transcripts[\\/]/.test(String(path));
}
