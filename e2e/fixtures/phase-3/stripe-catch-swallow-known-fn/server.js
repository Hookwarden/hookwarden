// HISTORICAL FALSE NEGATIVE — NOW CAUGHT. Directory name preserves the
// breadcrumb. See e2e/fixtures/phase-3/stripe-catch-swallow-known-fn/README.md
// for the v0.5 design discussion and v0.7 resolution.
//
// Current behavior (v0.7+): the `stripe/verification-error-swallowed` rule
// (part of the v0.7 ERS — Error-Swallowing — rule class) fires at high
// severity / not-verified. The handler still emits an info-level
// `stripe/library-verified` because the SDK call is reachable — together
// they document both the SDK import AND the structural defect.

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
