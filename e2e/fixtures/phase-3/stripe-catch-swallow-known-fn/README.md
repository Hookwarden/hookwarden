# Catch-block-swallow — historical false negative, now caught

## Historical context (v0.5)

This fixture demonstrated a scanner limitation: the engine reported
`verified` because `stripe.webhooks.constructEvent` was reachable from the
handler, but the surrounding `try`/`catch` defeated the verification by
silently returning `200 OK` from the catch handler. The bug was real; the
engine couldn't see it.

The directory name (`-known-fn` suffix) preserves the v0.5 breadcrumb so
the fixture stays visible in git history and the smoke harness keeps
pointing at the same path across releases.

## Current behavior (v0.7+)

The `stripe/verification-error-swallowed` rule (part of the v0.7 ERS —
Error-Swallowing — rule class) catches this pattern. Scan output:

```
! high      server.js:16:1  stripe/verification-error-swallowed  not-verified
i info      server.js:16:1  stripe/library-verified              verified
```

The two findings together document both the SDK import (info, positive
signal) and the structural defect (high, exploitable). The handler verdict
resolves to `not-verified` and exit code is `1` (default `--fail-on high`).

## Detection design (what changed v0.5 → v0.7)

The v0.5 design discussion identified three blockers:

1. Try/catch ancestry tracking on every `CallExpression`.
2. A catch-handler "swallows" classifier that distinguishes the bug from
   legitimate patterns:
   - `catch (e) { return res.status(400).send('bad sig'); }` (correct)
   - `catch (e) { throw e; }` (rethrow, fine)
   - `catch (e) { next(e); }` (Express error pipeline, fine)
   - `catch (e) { return processStored(req.body); }` (idempotency-key
     retry, legitimate but visually identical to a swallow)
3. Cross-provider extension (6 providers, not just Stripe).

All three landed as part of the v0.7 rule depth expansion. The rule
description spells out exactly which catch-handler shapes suppress the
finding — keeping false-positive rate inside the <5% correctness moat.
