# Known false negative — catch-block-swallow

This fixture demonstrates a scanner limitation: the engine reports
`verified` because `stripe.webhooks.constructEvent` is reachable from the
handler, but the surrounding `try`/`catch` defeats the verification by
silently returning `200 OK` from the catch handler.

## Current verdict

```
· info  server.js:14:1  stripe/library-verified  verified
Found 0 critical · 0 high · 0 medium · 0 low · 1 info · 0 manual-review
```

## Expected future verdict

```
! high  server.js:14:1  stripe/swallowed-verification-error  manual-review
```

(Or: `library-verified` downgraded to `manual-review` via a new
`verify_call_in_swallowing_catch` evidence kind.)

## Why this isn't fixed yet

Detecting this pattern correctly requires:

1. Try/catch ancestry tracking on every `CallExpression` (engine doesn't
   have this in v0.5).
2. A catch-handler "swallows" classifier that distinguishes the bug from
   legitimate patterns like:
   - `catch (e) { return res.status(400).send('bad sig'); }` (correct)
   - `catch (e) { throw e; }` (rethrow, fine)
   - `catch (e) { next(e); }` (Express error pipeline, fine)
   - `catch (e) { return processStored(req.body); }` (idempotency-key
     retry, legitimate but visually identical to a swallow)
3. Cross-provider extension (6 providers, not just Stripe).

A heuristic that fires on every `try`/`catch` around a verify call would
add >5% false-positives — outside the project's correctness moat.

The right fix is a new `verify_call_in_swallowing_catch` evidence kind
emitted by `build.ts`, consumed by `library-verified-recognition` to
downgrade `verified` → `manual-review`. Estimated ~half a day of careful
work + test fixtures.
