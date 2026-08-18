/**
 * Output Formatting Tools - Pretty-Printing & Syntax Highlighting
 *
 * Only smart_pretty is real in vendor's source as of this merge; the other
 * five files documented under this category (smart-format, smart-stream,
 * smart-report, smart-diff, smart-export, smart-log) are either unimplemented
 * stubs or non-compiling dead code in vendor/token-optimizer-mcp — confirmed
 * by direct inspection, not assumed. smart_diff/smart_log as live MCP tool
 * names are already owned by the file-operations category (merged in
 * checkpoint 1), so nothing here collides with them.
 */

export * from './smart-pretty.js';
