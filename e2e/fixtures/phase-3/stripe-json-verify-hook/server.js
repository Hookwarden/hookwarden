// Canonical Stripe reference pattern (from Stripe's own sample repos):
// `express.json()` is registered before the webhook route, BUT it uses a
// `verify` hook to capture the raw request bytes onto `req.rawBody`, which
// signature verification then reads. The raw body is NOT destroyed, so this
// is NOT the express-middleware-ordering bug.
//
// Regression guard for the false positive where the ordering predicate flagged
// any JSON parser before a Stripe route, blind to the raw-body-preserving
// verify hook (it FP'd on Stripe's official sample). The engine should emit
// `verified` (constructEvent is reachable) and NO ordering finding.
//
// Counterpart bug fixture: `canonical-stripe-bug` (unguarded express.json()).

const express = require('express');
const Stripe = require('stripe');
const app = express();
const stripe = new Stripe(process.env.STRIPE_KEY);

app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl.startsWith('/webhook')) {
        req.rawBody = buf;
      }
    },
  })
);

app.post('/webhooks/stripe', (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(
    req.rawBody,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET
  );
  res.json({ ok: true, type: event.type });
});

app.listen(3000);
