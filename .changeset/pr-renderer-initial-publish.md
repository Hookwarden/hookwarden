---
"@hookwarden/pr-renderer": minor
---

Initial publish of `@hookwarden/pr-renderer@1.0.0`.

This new package is the single source of truth for the sticky-comment shape used by both the public GitHub Action (`@hookwarden/github-action`) and the SaaS continuous-scanning worker (Hookwarden Cloud, private repo).

- Exports `renderSummaryBody`, `STICKY_MARKER`, `CLEAN_BODY`, `BOT_LOGIN`, and the `ScanFinding` / `ScanFindingLocation` types.
- `STICKY_MARKER` (`<!-- hookwarden:pr-summary -->`) is byte-locked — both consumers find each other's prior comments by this exact string, so a CLI-Action comment and a SaaS comment on the same PR collide on the same de-dupe key and the bot edits in place rather than posting duplicates.
- `comment.format.ts` and the finding types were moved out of `@hookwarden/github-action`; `github-action` now consumes them via a workspace dep (`@hookwarden/pr-renderer: workspace:*`). This is a structural refactor only — `@hookwarden/github-action`'s public API is unchanged, so no version bump on that package.
