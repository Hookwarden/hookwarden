// hookwarden:cve https://github.com/advisories/GHSA-jf52-3f2h-h9j5
// hookwarden:rule stripe/missing-signature-verification
// hookwarden:state vulnerable

// n8n GHSA-jf52-3f2h-h9j5 — community-contributed Stripe Trigger node accepted
// webhook events without verifying `Stripe-Signature`. Stripe webhooks landing
// at the node's HTTP endpoint were processed as authenticated events purely
// because the URL was difficult to guess — no HMAC verification was performed.
//
// Detection lane: stripe/missing-signature-verification.

import express from "express";

const app = express();

app.post(
  "/webhook/stripe-trigger",
  express.json(),
  (req, res) => {
    // BUG: no stripe-signature header read, no HMAC verification, no
    // SDK constructEvent call. Every POST to this route is processed as a
    // verified Stripe event.
    const event = req.body;

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
