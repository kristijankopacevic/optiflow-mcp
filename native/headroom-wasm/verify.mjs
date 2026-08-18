// Scratch verification script for Phase 1's gate: proves the wasm-pack
// `pkg/` output round-trips through Node end to end (not just that
// `wasm-pack build` exited 0). Not wired into any test suite yet — the
// plan's Phase 1 deliverable is "even a stub export".
//
// Run with: node native/headroom-wasm/verify.mjs
import { ping } from "./pkg/headroom_wasm.js";

const result = ping();
console.log("ping() returned:", JSON.stringify(result));

const expected = "headroom-wasm ok (headroom-core)";
if (result !== expected) {
  console.error(`FAIL: expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
  process.exit(1);
}
console.log("PASS: wasm module loaded and stub round-tripped correctly.");
