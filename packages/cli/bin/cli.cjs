#!/usr/bin/env node
// CommonJS wrapper so `npx hookwarden` works under any package manager.
// The real ESM entry is dist/index.js; we import via dynamic import.
(async () => {
  const { main } = await import("../dist/index.js");
  const code = await main(process.argv.slice(2));
  process.exit(code);
})();
