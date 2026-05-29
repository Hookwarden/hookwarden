// hookwarden:cve https://github.com/advisories/GHSA-jf52-3f2h-h9j5
// hookwarden:rule stripe/missing-signature-verification
// hookwarden:state fixed
// MANUAL-REVIEW: hookwarden's auto-fixer cannot inject a Stripe SDK dep into
// arbitrary user code. The fix surfaces as `manual-review`; the corpus's
// `fixed/` reference shows the recommended remediation pattern.

import express from "express";
import Stripe from "stripe";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is required");

const stripe = new Stripe(process.env.STRIPE_API_KEY ?? "");

const app = express();

app.post(
  "/webhook/stripe-trigger",
  // Stripe requires the raw body for HMAC verification — JSON middleware would
  // mangle the bytes before constructEvent can verify.
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.header("stripe-signature") ?? "";
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch {
      res.status(400).send("signature verification failed");
      return;
    }

    if (event.type === "checkout.session.completed") {
      processCheckout(event.data.object);
    }

    res.status(200).send("received");
  },
);

function processCheckout(session: unknown): void {
  console.log("processing", session);
}

app.listen(3000);
