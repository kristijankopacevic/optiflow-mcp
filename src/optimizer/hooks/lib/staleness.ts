// File-content indexing/diffing for the zero-turn refusal
// (`inject.ts`'s `refusalPayload`/`substitutionFor` — checkpoint 2).
//
// CHECKPOINT-2 STUB. Vendor's `staleness.mjs`
// (`vendor/token-optimizer-mcp/plugin/hooks/lib/staleness.mjs`,
// MIT-licensed — see THIRD_PARTY_LICENSES.md) is the module that lets a
// refusal carry a diff or an annotated skeleton instead of a bare
// redirect. `indexFile` is a pure enrichment step on the ALLOWED path
// (`pretooluse.ts` calls it after `harvest()` so the next touch can be
// answered with structure) — its failure mode is already "the next touch
// gets a plain redirect instead of a richer one", never a blocked call, so
// this checkpoint's no-op is a strict subset of vendor's own fail-open
// behavior, not a new one. `serve`/`diffLines` (used by `inject.ts`'s
// `forTouch`/`refusalPayload`) are deferred alongside `inject.ts` itself.

/** No-op in this checkpoint — see module header. */
export function indexFile(_dir: string, _path: string, _source: string): void {}
