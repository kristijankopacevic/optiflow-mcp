import { defineConfig } from "vitest/config";

// Dedicated config for the isolated-marketplace-install regression test
// (`src/plugin-install.itest.ts`). Deliberately separate from
// `vitest.config.ts`'s `include: ["src/**/*.test.ts"]`: this test spawns a
// real `node` process against a temp copy of the built `plugin/` tree and
// is much slower than the rest of the suite, so it's excluded from the
// default `npm test` run and only exercised via `npm run test:plugin-install`
// (which builds first -- see package.json).
export default defineConfig({
  test: {
    include: ["src/plugin-install.itest.ts"],
    environment: "node",
    watch: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
