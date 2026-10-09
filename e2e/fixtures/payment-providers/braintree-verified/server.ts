// Braintree webhook verified by the SDK, per
// https://developer.paypal.com/braintree/docs/guides/webhooks/parse — parse() throws on a bad signature.
import braintree from "braintree";
import express from "express";
import { db } from "./db";

const gateway = new braintree.BraintreeGateway({
  environment: braintree.Environment.Production,
  merchantId: process.env.BRAINTREE_MERCHANT_ID as string,
  publicKey: process.env.BRAINTREE_PUBLIC_KEY as string,
  privateKey: process.env.BRAINTREE_PRIVATE_KEY as string,
});

const app = express();

app.post("/webhooks/braintree", express.urlencoded({ extended: false }), async (req, res) => {
  const notification = await gateway.webhookNotification.parse(
    req.body.bt_signature,
    req.body.bt_payload,
  );
  await db.query("INSERT INTO braintree_events (kind) VALUES ($1)", [notification.kind]);
  res.sendStatus(200);
});

export default app;
