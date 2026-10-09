// PayPal postback whose result is never checked — PayPal answers 200 with
// verification_status "FAILURE" for forged events, so this verifies nothing.
import express from "express";
import { db } from "./db";

const app = express();

app.post("/webhooks/paypal", express.json(), async (req, res) => {
  await fetch("https://api-m.paypal.com/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transmission_id: req.headers["paypal-transmission-id"],
      transmission_sig: req.headers["paypal-transmission-sig"],
      webhook_event: req.body,
    }),
  });
  await db.query("UPDATE orders SET paid = true WHERE paypal_id = $1", [req.body.resource.id]);
  res.sendStatus(200);
});

export default app;
