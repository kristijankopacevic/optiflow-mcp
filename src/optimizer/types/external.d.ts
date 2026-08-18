// Ambient module declaration for optional/untyped external dependencies used
// by ported optimizer tools that have no first-party or @types/* typings.
//
// Ported from vendor/token-optimizer-mcp's own src/types/external.d.ts
// (MIT-licensed — see THIRD_PARTY_LICENSES.md), trimmed to only the modules
// actually imported by the tool categories merged so far. `graphlib` (used by
// src/optimizer/tools/intelligence/knowledge-graph.ts) ships no TypeScript
// declarations of its own and there is no `@types/graphlib` dependency here,
// so this treats it as `any` at the module boundary the same way vendor did.
declare module 'graphlib';
