// Standard Webhooks handler whose only provider signal is the `webhook-signature` header (also
// NMI's header name). It must stay attributed to standardwebhooks and be flagged — not tie with NMI.
import express from "express";
import { db } from "./db";

const app = express();

app.post("/webhook", express.json(), async (req, res) => {
  const signature = req.headers["webhook-signature"];
  console.log("received", signature);
  await db.query("INSERT INTO events (body) VALUES ($1)", [JSON.stringify(req.body)]);
  res.sendStatus(200);
});

export default app;
