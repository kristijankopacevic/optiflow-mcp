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
