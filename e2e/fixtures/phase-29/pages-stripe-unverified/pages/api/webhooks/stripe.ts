// Phase 29 regression fixture: a BROKEN Pages Router Stripe webhook — reads the parsed body and
// acts on it with NO signature verification. Must scan `not-verified` critical.
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const event = req.body;
  if (event.type === "checkout.session.completed") {
    await fulfillOrder(event.data.object);
  }
  return res.status(200).json({ received: true });
}
