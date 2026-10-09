// Braintree webhook that decodes bt_payload directly instead of letting the SDK verify bt_signature.
import braintree from "braintree";
import express from "express";
import { db } from "./db";

export const gateway = new braintree.BraintreeGateway({
  environment: braintree.Environment.Production,
  merchantId: process.env.BRAINTREE_MERCHANT_ID as string,
  publicKey: process.env.BRAINTREE_PUBLIC_KEY as string,
  privateKey: process.env.BRAINTREE_PRIVATE_KEY as string,
});

const app = express();

app.post("/webhooks/braintree", express.urlencoded({ extended: false }), async (req, res) => {
  const xml = Buffer.from(req.body.bt_payload, "base64").toString("utf8");
  await db.query("INSERT INTO braintree_events (payload) VALUES ($1)", [xml]);
  res.sendStatus(200);
});

export default app;
