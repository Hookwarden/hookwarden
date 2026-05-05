import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/webhooks/shopify", async (req, res) => {
  const sig = (req.header("X-Shopify-Hmac-Sha256") ?? "") as string;
  const expected = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET ?? "")
    .update(req.body)
    .digest("base64");
  // BUG: plain === comparison leaks timing.
  if (sig !== expected) return res.status(403).end();
  res.status(200).end();
});

app.listen(3000);
