// Test-only helper for loading `fixtures/cli-output/*.txt` golden samples.
// Not a `*.test.ts` file itself (vitest's `include` pattern in
// vitest.config.ts is `src/**/*.test.ts`), so this is safe to import from
// multiple filter test files without vitest trying to run it directly.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/cli-output/", import.meta.url));

export function loadCliOutputFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}
