// Phase 29 regression fixture (boxyhq/saas-starter-kit shape): a textbook-CORRECT Next.js Pages
// Router Stripe webhook. bodyParser disabled, raw body read via a getRawBody stream helper, then
// verified with stripe.webhooks.constructEvent over the raw bytes. Must scan `verified`
// (stripe/library-verified) with NO stripe/raw-body-misuse — guards the P1 raw-body signal.
import Stripe from "stripe";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Readable } from "node:stream";

const stripe = new Stripe(process.env.STRIPE_KEY as string);

export const config = { api: { bodyParser: false } };

async function getRawBody(readable: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET as string);
  } catch (err) {
    return res.status(400).json({ error: "bad signature" });
  }
  return res.status(200).json({ received: true, type: event.type });
}
