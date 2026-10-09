// PayPal webhook that trusts the event without verifying PAYPAL-TRANSMISSION-SIG.
import express from "express";
import { db } from "./db";

const app = express();

app.post("/webhooks/paypal", express.json(), async (req, res) => {
  const event = req.body;
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    await db.query("UPDATE orders SET paid = true WHERE paypal_id = $1", [event.resource.id]);
  }
  res.sendStatus(200);
});

export default app;
