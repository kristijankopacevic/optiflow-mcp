// Dedicated config, mirroring vitest.plugin-install.config.ts. The `.itest.ts`
// extension keeps this OUT of `vitest.config.ts`'s `include: src/**/*.test.ts`,
// so `npm test` stays fast and CLI-independent.
//
// Separate from the main vitest config: this suite spawns a real `claude -p`
// session, so it is slow, costs tokens, and requires the CLI on PATH. It is
// wired to `npm run test:mcp-e2e` rather than `npm test` for that reason.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/mcp-compression.e2e.itest.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
