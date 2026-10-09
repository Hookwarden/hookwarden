// Two PayPal routes in one file: /webhooks/paypal verifies by postback, /paypal/webhook-legacy
// does not. The legacy route must not inherit the other route's verification.
import express from "express";
import { db } from "./db";

const app = express();

app.post("/webhooks/paypal", express.json(), async (req, res) => {
  const verification = await fetch(
    "https://api-m.paypal.com/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: JSON.stringify({
        transmission_sig: req.headers["paypal-transmission-sig"],
        webhook_event: req.body,
      }),
    },
  );
  const { verification_status } = await verification.json();
  if (verification_status !== "SUCCESS") return res.sendStatus(400);
  return res.sendStatus(200);
});

app.post("/paypal/webhook-legacy", express.json(), async (req, res) => {
  const transmission = req.headers["paypal-transmission-id"];
  await db.query("UPDATE orders SET paid = true WHERE paypal_id = $1", [req.body.resource.id]);
  res.json({ transmission });
});

export default app;
