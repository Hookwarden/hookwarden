# Release-smoke fixture (Phase 4.2 binary distribution)

Used by `.github/workflows/release-binaries.yml`'s per-target smoke step. Every
matrix leg (Linux arm64, Linux x64, Windows x64) runs `hookwarden scan` against
this directory and asserts the compiled binary executes both the JS and Python
parsers end-to-end (proves DIST-04 — same rule pack ships in every target — and
DIST-05 — embedded WASM Python grammar works in the compiled binary).

## Files

- `stripe-verified.ts` — Stripe handler using `stripe.webhooks.constructEvent`
  after `express.raw({ type: "application/json" })`. RULES-04 library-verified.
- `stripe-not-verified.ts` — Express middleware-ordering bug (`app.use(express.json())`
  before the webhook route). RULES-03 not-verified at critical severity.
- `stripe_verified.py` — Flask handler using `stripe.Webhook.construct_event`
  with `request.get_data()` for raw bytes. RULES-04 library-verified.
- `stripe_not_verified.py` — Flask handler that reads the body and parses JSON
  without HMAC verification. RULES-02 not-verified.

## Smoke contract

The per-target smoke step in `release-binaries.yml` asserts, for each binary:

1. `./hookwarden-<target> --version` returns a non-empty version string (and on
   tag-push it must contain the tag minus the leading `v`).
2. `./hookwarden-<target> scan packages/cli/test/fixtures/release-smoke/` exits
   non-zero (Phase 4 CLI-04 default — not-verified findings at/above the `high`
   threshold). The smoke step rejects exit `0` AND any code `>=2` (engine,
   config, parse errors are smoke failures, not expected outcomes).
3. The scan output contains BOTH `verified` and `not-verified` states (proves
   both code paths execute on every target).
4. `strings <binary> | grep -F -f deny-list.txt` (or the PowerShell printable-
   ASCII equivalent on Windows) finds no matches. The deny-list is emitted by
   `packages/cli/scripts/forbidden-deps.ts` with the 4-char-minimum filter
   applied upstream at emit time (W1 fix — every platform scanner sees the
   same filtered input).

Smoke target: <30s per leg so the full 3-leg matrix completes in <2min.

## macOS legs

Plan 04.2-04 (macOS sign+notarize) is deferred per the 2026-05-06 revision —
Apple Developer Program enrollment is unfunded for v0.3.0. When macOS is
restored, this fixture corpus needs no changes; the existing bash branch of the
smoke step covers macOS automatically.
