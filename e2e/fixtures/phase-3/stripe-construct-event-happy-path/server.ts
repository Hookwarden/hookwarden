// Correct Stripe webhook handler. constructEvent reachable from the route, raw body
// preserved via express.raw on the webhook path only. Engine emits verified via
// stripe/library-verified.

import express from 'express';
import Stripe from 'stripe';

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2024-06-20' });

app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    try {
      const event = stripe.webhooks.constructEvent(req.body, sig, secret);
      console.log('Verified Stripe event:', event.type);
      res.json({ received: true });
    } catch (err) {
      res.status(400).send(`Webhook Error: ${(err as Error).message}`);
    }
  },
);

app.listen(3000);
