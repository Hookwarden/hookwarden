// Express webhook handler where Stripe verification is done in an INLINE
// arrow-function route middleware (rather than in the final handler arg).
// This is a valid Express pattern; the engine should recognize the
// stripe.webhooks.constructEvent call reachable via the route-arg
// arrow-function middleware and emit `verified`, not `not-verified`.
//
// Counterpart bug fixture is `canonical-stripe-bug` (no verification at all);
// this fixture proves the FP fix doesn't downgrade the bug fixture's verdict.

const express = require('express');
const Stripe = require('stripe');
const app = express();
const stripe = new Stripe(process.env.STRIPE_KEY);
const secret = process.env.WEBHOOK_SECRET;

app.post('/webhooks/stripe',
  // raw-body middleware (named — already recognised by collectRawBodyMiddlewareEvidence)
  express.raw({ type: 'application/json' }),
  // INLINE ARROW middleware that does the verification.
  // Before this fix: engine doesn't see constructEvent here, marks handler not-verified.
  // After this fix: engine sees constructEvent in the arrow body, emits sdk_verify_call
  //                 evidence, evaluator promotes verdict to `verified`.
  (req, res, next) => {
    const sig = req.headers['stripe-signature'];
    try {
      req.event = stripe.webhooks.constructEvent(req.body, sig, secret);
      next();
    } catch (e) {
      return res.status(400).send('bad sig');
    }
  },
  // Final handler — only reached if signature verified above.
  (req, res) => {
    res.json({ok: true, type: req.event.type});
  }
);
app.listen(3000);
