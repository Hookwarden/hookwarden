# @hookwarden/pr-renderer

Markdown PR-comment renderer for [hookwarden](https://hookwarden.dev).

This package is the **single source of truth** for the sticky-comment shape used by both:

- the public **GitHub Action** ([`@hookwarden/github-action`](../github-action)), which posts comments on the user's own PRs from CLI scan output, and
- the **SaaS continuous-scanning worker** (Hookwarden Cloud), which renders the same comment shape from server-side scans.

## Why a separate package?

Keeping the renderer in one place means the de-duplication key the bot uses to find its own prior comments — `STICKY_MARKER = "<!-- hookwarden:pr-summary -->"` — is byte-identical across both consumers. A CLI-Action comment and a SaaS comment on the same PR collide on the same marker and the bot edits in place rather than posting duplicates.

**Do not edit `STICKY_MARKER` without coordinating with the plan-grep gate** that enforces its exact spelling in CI.

## Exports

- `renderSummaryBody(input)` — produces the sticky markdown body
- `STICKY_MARKER` / `CLEAN_BODY` / `BOT_LOGIN` — byte-locked literals
- `ScanFinding` / `ScanFindingLocation` — the finding shape the renderer accepts

## License

Apache-2.0.
