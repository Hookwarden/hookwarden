// PayPal webhook verified by postback, per https://developer.paypal.com/api/rest/webhooks/rest/:
// send the paypal-* headers, webhook ID and event to verify-webhook-signature; require SUCCESS.
import express from "express";
import { db } from "./db";
import { getAccessToken } from "./paypal-auth";

const app = express();

app.post("/webhooks/paypal", express.json(), async (req, res) => {
  const verification = await fetch(
    "https://api-m.paypal.com/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getAccessToken()}`,
      },
      body: JSON.stringify({
        auth_algo: req.headers["paypal-auth-algo"],
        cert_url: req.headers["paypal-cert-url"],
        transmission_id: req.headers["paypal-transmission-id"],
        transmission_sig: req.headers["paypal-transmission-sig"],
        transmission_time: req.headers["paypal-transmission-time"],
        webhook_id: process.env.PAYPAL_WEBHOOK_ID,
        webhook_event: req.body,
      }),
    },
  );
  const { verification_status } = await verification.json();
  if (verification_status !== "SUCCESS") return res.sendStatus(400);
  await db.query("UPDATE orders SET paid = true WHERE paypal_id = $1", [req.body.resource.id]);
  return res.sendStatus(200);
});

export default app;
