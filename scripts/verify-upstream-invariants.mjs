#!/usr/bin/env node
// Regression guard for Module 1's single load-bearing assumption: that
// vendor/token-optimizer-mcp's own PreToolUse hook never emits
// `updatedInput`. optiflow's chop hook (src/chop/pretooluse.ts) rewrites
// `Bash` commands via `updatedInput`; both hooks fire in parallel on the
// same `Bash` PreToolUse event (Claude Code runs same-event hooks
// concurrently), so if the vendored plugin ever started emitting
// `updatedInput` too, the two rewrites would race with no error message —
// exactly the failure mode plan Risk R9 describes.
//
// Deliberately dependency-free plain JS (no TypeScript, no build step) so it
// can run standalone in CI or via `npm run verify-upstream` without needing
// `npm run build` first — see docs/architecture.md's Locked Decisions.
//
// This does NOT try to prove upstream will never add `updatedInput` in some
// clever indirect way (e.g. building the string at runtime) — it's a
// specific, cheap tripwire for the common case (a literal source-code
// change), not a formal guarantee. If it ever fires, treat it as "stop and
// re-read Module 1's trust-boundary docs before merging a submodule bump,"
// not as a false alarm to silence.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const vendorHooksDir = path.join(repoRoot, "vendor", "token-optimizer-mcp", "plugin", "hooks");
const vendorHooksJson = path.join(vendorHooksDir, "hooks.json");

const failures = [];

function collectFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (st.isFile() && (entry.endsWith(".mjs") || entry.endsWith(".js") || entry.endsWith(".ts"))) {
      out.push(full);
    }
  }
  return out;
}

if (!existsSync(vendorHooksJson)) {
  failures.push(
    `vendor/token-optimizer-mcp/plugin/hooks/hooks.json not found. Is the submodule initialized? ` +
      `Run: git submodule update --init --recursive`
  );
} else {
  const hooksConfig = JSON.parse(readFileSync(vendorHooksJson, "utf8"));
  const preToolUse = hooksConfig.hooks?.PreToolUse ?? [];
  const bashEntry = preToolUse.find((entry) => typeof entry.matcher === "string" && entry.matcher.includes("Bash"));

  if (!bashEntry) {
    failures.push(
      "vendor/token-optimizer-mcp's hooks.json no longer registers a PreToolUse hook matching " +
        "'Bash'. Module 1's chop hook assumes it shares the Bash PreToolUse event with token-optimizer's " +
        "own router — re-verify this assumption still holds (the vendored plugin may have restructured " +
        "its hook wiring) before trusting the rest of this check."
    );
  }

  const allHookFiles = collectFiles(vendorHooksDir);
  if (allHookFiles.length === 0) {
    failures.push(`No hook source files found under ${vendorHooksDir} — submodule may be empty/uninitialized.`);
  }

  const offenders = [];
  for (const file of allHookFiles) {
    const text = readFileSync(file, "utf8");
    if (text.includes("updatedInput")) {
      offenders.push(path.relative(repoRoot, file));
    }
  }

  if (offenders.length > 0) {
    failures.push(
      `vendor/token-optimizer-mcp now emits 'updatedInput' from: ${offenders.join(", ")}. ` +
        `Module 1's chop hook (src/chop/pretooluse.ts) and token-optimizer's own PreToolUse hook both ` +
        `fire on 'Bash' in parallel — if upstream now rewrites 'command' too, the two rewrites can race ` +
        `with no error surfaced (plan Risk R9). Re-read docs/architecture.md's Authority Map and ` +
        `Module 1's trust-boundary notes before proceeding; this may require optiflow to detect and ` +
        `defer to upstream's rewrite, or to stop rewriting Bash itself, depending on what changed.`
    );
  }
}

if (failures.length > 0) {
  console.error("FAIL: upstream invariant check (scripts/verify-upstream-invariants.mjs)\n");
  for (const failure of failures) {
    console.error(`  - ${failure}\n`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "OK: vendor/token-optimizer-mcp still registers a PreToolUse:Bash hook and never emits 'updatedInput' " +
      "anywhere under plugin/hooks/ — Module 1's chop hook's load-bearing assumption still holds."
  );
}
