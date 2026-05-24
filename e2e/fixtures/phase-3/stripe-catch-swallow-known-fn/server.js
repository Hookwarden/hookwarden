// KNOWN FALSE NEGATIVE — see e2e/fixtures/phase-3/stripe-catch-swallow-known-fn/README.md.
// Engine currently marks this handler `verified` because stripe.webhooks.constructEvent is
// reachable. The catch block silently swallows verification failures and returns 200, which
// defeats the entire purpose of verification — but detecting this requires try/catch ancestry
// tracking + catch-handler "swallows" classification that the engine doesn't have in v0.5.
//
// Expected future behavior: when `verify_call_in_swallowing_catch` evidence is emitted by a
// future build.ts overlay, library-verified-recognition should downgrade `verified` →
// `manual-review`. See open issue (TODO: file URL) for the design discussion.

const express = require('express');
const Stripe = require('stripe');
const app = express();
const stripe = new Stripe(process.env.STRIPE_KEY);

app.post('/webhooks/stripe', express.raw({type:'application/json'}), (req, res) => {
  try {
    const evt = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.SECRET,
    );
    // process event...
    res.json({ok: true});
  } catch (e) {
    console.error('verify failed:', e);
    // BUG: returns 200 even on verification failure.
    // Stripe will see the 200 and stop retrying the event with a real signature.
    res.json({ok: true});
  }
});
app.listen(3000);
