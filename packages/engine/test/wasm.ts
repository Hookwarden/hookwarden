// Shared test helper: resolve the tree-sitter-python.wasm path independent of cwd.
// Uses createRequire(import.meta.url) so resolution starts from the test file's location,
// which works in both `pnpm --filter` (workspace cwd) and direct vitest invocations.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function resolvePythonWasmPath(): string {
  // tree-sitter-python ships the .wasm next to its package.json; resolve the package.json
  // (which IS in node's resolution path) and join up the sibling wasm.
  const pkgPath = require.resolve("tree-sitter-python/package.json");
  return join(dirname(pkgPath), "tree-sitter-python.wasm");
}
