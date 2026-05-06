#!/usr/bin/env node
// Bundles two .wasm artifacts into the CLI's stable wasm/ path:
//   1. tree-sitter-python.wasm — the Python grammar. Sourced from the
//      tree-sitter-python npm package (devDep). The native binding from
//      tree-sitter-python is dead weight (node-gyp-build fails on musl,
//      needs a C++ toolchain otherwise); hookwarden only uses the WASM,
//      so we stay on web-tree-sitter and ship the .wasm directly.
//   2. web-tree-sitter.wasm — the tree-sitter runtime itself. Bun's bundler
//      can't resolve `web-tree-sitter/web-tree-sitter.wasm` through pnpm's
//      hoisted node_modules layout (`error: Could not resolve... maybe you
//      need to bun install`), so we mirror the file into the same wasm/
//      directory and import via a relative path. Phase 4.2 Bug #5.
//
// Run via: `prepare` script (after pnpm install in the workspace) AND `prepack`
// (before npm publish) AND in CI before `bun build --compile`. Idempotent.

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, "..");
const destDir = join(CLI_ROOT, "wasm");

mkdirSync(destDir, { recursive: true });

function resolvePackageDir(packageName, subpath) {
  // Some packages (notably web-tree-sitter) don't expose ./package.json in
  // their `exports` map, so `require.resolve("<pkg>/package.json")` throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve a known-exported subpath instead
  // and walk up to the package directory.
  const resolved = require.resolve(`${packageName}/${subpath}`);
  return dirname(resolved);
}

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

// tree-sitter-python's package.json IS exported (no `exports` map at all
// → all subpaths public), so we can use that as the resolution anchor.
copyAsset(dirname(require.resolve("tree-sitter-python/package.json")), "tree-sitter-python.wasm");
// web-tree-sitter has an `exports` map that whitelists ./web-tree-sitter.wasm;
// resolve via that subpath to find the package directory.
copyAsset(resolvePackageDir("web-tree-sitter", "web-tree-sitter.wasm"), "web-tree-sitter.wasm");
// Silent on success — runs on every install. Failure path uses console.error above.
