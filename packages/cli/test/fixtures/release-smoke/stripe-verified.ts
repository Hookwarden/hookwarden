// Fixture: a Stripe webhook handler that uses the library-verified path.
// Phase 4.2 release-binaries.yml smoke step scans this directory and asserts the
// compiled binary recognises `stripe.webhooks.constructEvent` as RULES-04 verified.
// The Linux + Windows matrix legs both exercise this file (proves DIST-04 — same
// rule pack ships in every target). The Python sibling `stripe_verified.py`
// exercises the embedded WASM Python grammar (proves DIST-05).
import express from "express";
import Stripe from "stripe";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

// Raw body middleware MUST run before the webhook route — stripe.webhooks.constructEvent
// requires Buffer input to verify the HMAC signature against the unparsed JSON.
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    res.status(200).json({ received: true, type: event.type });
  },
);

app.listen(3000);
