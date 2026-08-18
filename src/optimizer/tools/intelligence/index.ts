/**
 * Intelligence & AI Tools
 */

export * from './shared-instances.js';
export * from './knowledge-graph.js';
export * from './anomaly-explainer.js';
export * from './sentiment-analysis.js';
export * from './wiki-read.js';
export * from './wiki-write.js';
// The six tools below are ported faithfully (real class/schema/factory
// shapes) but their `run()` bodies are vendor's own stubs -- each returns a
// fixed `{ result: '<operation> completed successfully' }` payload rather
// than doing any real work. This matches vendor's own
// src/tools/intelligence/index.ts, which marks every one of them
// "Implementation pending". See the merge report for the per-tool detail.
export * from './intelligent-assistant.js';
export * from './natural-language-query.js';
export * from './pattern-recognition.js';
export * from './predictive-analytics.js';
export * from './recommendation-engine.js';
export * from './smart-summarization.js';

// vendor/token-optimizer-mcp/src/tools/intelligence/auto-remediation.ts
// (the 13th file in vendor's own category) is deliberately NOT ported here.
// Verified directly: it references `CacheEngine`/`TokenCounter`/
// `MetricsCollector` (inside its own `runAutoRemediation` wrapper) with NO
// import statement for any of them anywhere in the file -- it would not
// compile if anything actually imported it. Confirmed nothing does: grepping
// the whole vendor/token-optimizer-mcp/src and /plugin trees for
// "AutoRemediation" finds only the file referencing itself. Vendor's own
// src/server/index.ts never dispatches it either. This is genuinely dead,
// broken code in vendor's own source (not excluded via vendor's tsconfig,
// just never wired to anything) -- the same category of gap as
// output-formatting's stub/truncated files, not an oversight to silently fix
// by writing the missing imports ourselves.
