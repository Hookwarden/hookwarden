import crypto from "node:crypto";
import express from "express";

const app = express();
// BUG: express.json() globally registered before the webhook route consumes raw bytes.
app.use(express.json());

app.post("/webhooks/shopify", async (req, res) => {
  const sig = (req.header("X-Shopify-Hmac-Sha256") ?? "") as string;
  const expected = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET ?? "")
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
