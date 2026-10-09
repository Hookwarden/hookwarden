// NMI payment webhook verified per https://docs.nmi.com/reference/overview:
// HMAC-SHA256 (hex) over `<nonce>.<raw body>`, header `Webhook-Signature: t=<nonce>,s=<sig>`.
import crypto from "node:crypto";
import express from "express";
import { db } from "./db";

const app = express();

app.post("/webhooks/nmi", express.raw({ type: "application/json" }), async (req, res) => {
  const header = req.headers["webhook-signature"];
  const match = /t=(.*),s=(.*)/.exec(typeof header === "string" ? header : "");
  if (!match) return res.sendStatus(401);
  const [, nonce, signature] = match;
  const expected = crypto
    .createHmac("sha256", process.env.NMI_WEBHOOK_SIGNING_KEY as string)
    .update(`${nonce}.${req.body.toString("utf8")}`)
    .digest("hex");
  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return res.sendStatus(401);
  }
  const event = JSON.parse(req.body.toString("utf8"));
  await db.query("UPDATE orders SET paid = true WHERE id = $1", [event.event_body.order_id]);
  return res.sendStatus(200);
});

export default app;
