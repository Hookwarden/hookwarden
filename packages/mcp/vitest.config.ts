import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 60000,
    // boot-drift-stderr.test.ts mutates packages/mcp/dist/build-manifest.json
    // and all scan-handler tests read it via loadBuildManifest() default path.
    // File-parallel execution races on this shared physical file. The package
    // is small enough that single-fork serialization is the right trade.
    fileParallelism: false,
  },
});
