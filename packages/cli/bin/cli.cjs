#!/usr/bin/env node
// CommonJS wrapper so `npx hookwarden` works under any package manager.
// The real ESM entry is dist/index.js; we import via dynamic import.
//
// Setting process.exitCode (instead of calling process.exit() directly) lets Node
// drain stdout before exiting. Calling process.exit() immediately on a large
// payload (e.g. SARIF output for a multi-provider rule pack > 64 KB) truncates
// stdout when piped to a consumer with the default OS pipe buffer — observed in
// vitest spawnSync tests after Phase 6 grew the rule pack from 14 to 41 keys.
(async () => {
  const { main } = await import("../dist/index.js");
  process.exitCode = await main(process.argv.slice(2));
})();
