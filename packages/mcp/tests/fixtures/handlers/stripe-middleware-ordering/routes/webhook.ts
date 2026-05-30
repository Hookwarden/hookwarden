// Wave 0 fixture for Plan 23-05 — the verification call lives here, but
// the upstream `app.use(express.json())` in ../app.ts has already consumed
// the raw body by the time req.body reaches constructEvent.
import { Router } from "express";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export const webhookRouter = Router();

webhookRouter.post("/", (req, res) => {
  const sig = req.headers["stripe-signature"] as string;
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    res.json({ received: true, type: event.type });
  } catch {
    res.status(400).send("invalid signature");
  }
});
