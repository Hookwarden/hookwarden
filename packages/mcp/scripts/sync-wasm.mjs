#!/usr/bin/env node
// Bundles the tree-sitter-python .wasm artifact into the MCP server's stable
// wasm/ path:
//   - tree-sitter-python.wasm — the Python grammar. Sourced from the
//     tree-sitter-python npm package (devDep). The native binding is dead
//     weight (node-gyp-build fails on musl, needs a C++ toolchain otherwise);
//     hookwarden's engine only uses the WASM, so we stay on web-tree-sitter
//     and ship the .wasm directly.
//
// The MCP server does not bundle PHP (engine's PHP support is not required
// for scan_handler v0.8.0) and does not need the web-tree-sitter runtime
// .wasm in this directory — the loader uses web-tree-sitter's own
// `locateFile` shim under Node, which resolves the runtime artifact via
// the installed package layout (see src/wasm/loader.ts).
//
// Run via: `prepare` script (after pnpm install in the workspace) AND
// `prepack` (before npm publish). Idempotent.

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(__dirname, "..");
const destDir = join(MCP_ROOT, "wasm");

mkdirSync(destDir, { recursive: true });

function copyAsset(packageDir, fileName) {
  const sourceFile = join(packageDir, fileName);
  const destFile = join(destDir, fileName);
  if (!existsSync(sourceFile)) {
    console.error(`[sync-wasm] ${fileName} not found at ${sourceFile} — has 'pnpm install' run?`);
    process.exit(1);
  }
  const needsCopy =
    !existsSync(destFile) || statSync(sourceFile).mtimeMs > statSync(destFile).mtimeMs;
  if (needsCopy) {
    copyFileSync(sourceFile, destFile);
  }
}

// tree-sitter-python's package.json is exported (no `exports` map at all
// → all subpaths public), so we use that as the resolution anchor.
copyAsset(dirname(require.resolve("tree-sitter-python/package.json")), "tree-sitter-python.wasm");
// Silent on success — runs on every install. Failure path uses console.error above.
