// NMI payment webhook that trusts the payload without checking Webhook-Signature.
import express from "express";
import { db } from "./db";

const app = express();

app.post("/webhooks/nmi", express.json(), async (req, res) => {
  const event = req.body;
  await db.query("UPDATE orders SET paid = true WHERE id = $1", [event.event_body.order_id]);
  res.sendStatus(200);
});

export default app;
