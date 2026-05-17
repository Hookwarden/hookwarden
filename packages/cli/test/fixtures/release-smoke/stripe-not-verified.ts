// Fixture: a Stripe webhook handler with the express.json() middleware-ordering bug.
// Phase 4.2 release-binaries.yml smoke step scans this directory and asserts the
// compiled binary recognises this as RULES-03 not-verified (express.json before the
// webhook route consumes the raw body Stripe needs for HMAC verification).
// Adapted from test/fixtures/precommit/stripe-not-verified.ts; same bug, fresh
// header so this file is not mistaken for the pre-commit fixture.
import express from "express";
import Stripe from "stripe";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

// BUG: express.json() must NOT run before /webhook — it consumes the raw body Stripe needs.
app.use(express.json());

app.post("/webhook", (req, res) => {
  const sig = req.headers["stripe-signature"] as string;
  // BUG: req.body is the parsed JSON object, not the raw bytes — verification will fail silently
  // or constructEvent will throw. Either way, this handler is NOT VERIFIED.
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  res.status(200).json({ received: true, type: event.type });
});

app.listen(3000);
