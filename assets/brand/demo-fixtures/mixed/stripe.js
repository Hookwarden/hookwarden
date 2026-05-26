// Stripe billing webhook — raw body preserved, signature verified by the SDK.
const express = require('express');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(
    req.body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET,
  );
  console.log('Verified Stripe event:', event.type);
  res.json({ received: true });
});

app.listen(3000);
