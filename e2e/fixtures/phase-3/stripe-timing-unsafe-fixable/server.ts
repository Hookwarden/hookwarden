import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/webhooks/stripe", (req, res) => {
  const sig = (req.header("stripe-signature") ?? "") as string;
  const expected = crypto
    .createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .update(req.body as Buffer)
    .digest("hex");
  if (sig === expected) return res.status(200).end();
  res.status(403).end();
});

app.listen(3000);
