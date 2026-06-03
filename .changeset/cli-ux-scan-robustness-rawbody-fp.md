---
"@hookwarden/engine": patch
"hookwarden": patch
---

Real-app correctness + scan-robustness + terminal-UX fixes (found auditing dub / cal.com / documenso):

- **engine: `req.text()` / `req.arrayBuffer()` now count as raw-body access.** The raw-body evidence
  detector recognized `express.raw`, `req.body`, `php://input`, etc. but not the Web Fetch API reads
  used by Next.js App Router / Remix / Hono — exactly the pattern Stripe's docs prescribe
  (`const buf = await req.text(); stripe.webhooks.constructEvent(buf, sig, secret)`). Correctly-verified
  App Router webhooks were flagged `stripe/raw-body-misuse` — a false-positive critical on textbook
  code. Now recognized (incl. `.clone()`d request vars like `clonedReq.text()`), without
  over-suppressing genuine misuse (`response.text()` still doesn't count).

- **`scan` fails loud on an unscannable target.** A nonexistent / unreadable / non-file-or-dir path
  used to walk an empty tree → exit 0 "No findings" — a false all-clear for a CI security gate. It now
  exits 3 with `error: cannot scan '<path>': …`. (`inventory`, a listing command, stays graceful.)
  `/dev/null` and broken symlinks no longer leak an internal `ENOTDIR` baseline path.

- **`--no-trivia` / `--no-update-notifier` are now accepted.** Both were documented in `--help` and
  consumed by `scan` but missing from the flag allowlist, so they were rejected as unknown flags.

- **file:line hyperlinks anchor correctly.** Scanning a single file emitted a doubled-basename link
  (`…/x.js/x.js:3:1`); `inventory` resolved links against `process.cwd()` instead of the scan root.
  Both now anchor to the scan directory.

- **footer tally trims zero tiers.** `Found 2 critical · 0 high · 0 medium · 0 low · 0 info · 0 manual-review`
  → `Found 2 critical`. Only non-zero severities show; `manual-review` shows only when present.
