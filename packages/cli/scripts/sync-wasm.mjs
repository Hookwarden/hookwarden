#!/usr/bin/env node
// Bundles tree-sitter-python.wasm into the CLI's published artifact path.
//
// Why this exists: `tree-sitter-python` (the npm package) ships both a native
// binding and a WASM grammar artifact. The native binding runs `node-gyp-build`
// at install time, which fails on platforms without prebuilds (Alpine/musl) and
// requires C++ toolchain on others. hookwarden only uses the WASM grammar via
// web-tree-sitter, so the native install is dead weight + a portability footgun.
//
// This script copies the .wasm artifact from node_modules into a stable
// path inside the CLI package, so `tree-sitter-python` can stay a *devDep*
// (build-time only) and never reach end-user installs.
//
// Run via: `prepare` script (after pnpm install in the workspace) AND `prepack`
// (before npm publish). Idempotent — overwrites if newer.

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, "..");

const sourcePkgPath = require.resolve("tree-sitter-python/package.json");
const sourceWasm = join(dirname(sourcePkgPath), "tree-sitter-python.wasm");
const destDir = join(CLI_ROOT, "wasm");
const destWasm = join(destDir, "tree-sitter-python.wasm");

if (!existsSync(sourceWasm)) {
  console.error(
    `[sync-wasm] tree-sitter-python.wasm not found at ${sourceWasm} — has 'pnpm install' run?`,
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

const needsCopy =
  !existsSync(destWasm) || statSync(sourceWasm).mtimeMs > statSync(destWasm).mtimeMs;

if (needsCopy) {
  copyFileSync(sourceWasm, destWasm);
}
// Silent on success — runs on every install. Failure path uses console.error above.
