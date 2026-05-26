---
"hookwarden": patch
"@hookwarden/engine": patch
---

Two DX/correctness fixes:

- **`hookwarden fix <file>`** (a single-file path) now works. It silently reported "0 fixable
  findings" because the file path was used as the base directory for re-parsing the touched
  files, so `path.join()` produced bogus paths and the codegen never ran. Directory scans were
  unaffected.
- **Engine version is no longer stale.** The footer (`engine vX`) and SARIF `tool.driver.version`
  reported `0.5.0` across the entire 0.5.x line. `packages/engine/src/version.ts` is now generated
  from `package.json` (mirroring `@hookwarden/rules`) with a drift-gate test, so it can't fall out
  of sync again.
