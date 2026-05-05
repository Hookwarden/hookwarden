import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/webhooks/shopify", async (req, res) => {
  const sig = (req.header("X-Shopify-Hmac-Sha256") ?? "") as string;
  // BUG: sha512 instead of sha256 — Shopify signs with HMAC-SHA256.
  const expected = crypto
    .createHmac("sha512", process.env.SHOPIFY_API_SECRET ?? "")
    .update(req.body)
    .digest("base64");
  if (
    !crypto.timingSafeEqual(Buffer.from(sig, "base64"), Buffer.from(expected, "base64"))
  ) {
    return res.status(403).end();
  }
  res.status(200).end();
});

app.listen(3000);
