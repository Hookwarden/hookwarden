import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "test/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "e2e/**/*.test.ts",
    ],
    reporters: ["default"],
    // Phase 1 integration tests mutate shared on-disk fixtures
    // (dist/__inspector-fixture.js, packages/engine/src/__sc2-fixture.ts) and
    // SC3 spawns a nested vitest. Parallel files race; force one file at a time.
    fileParallelism: false,
    // Phase 3 e2e tests run main(argv) in-process: walker + babel + tree-sitter wasm
    // init + engine + renderer chain on real fixtures. Default 5s timeout is too tight.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
