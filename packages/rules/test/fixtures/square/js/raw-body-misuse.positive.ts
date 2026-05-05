import crypto from "node:crypto";
import express from "express";

const app = express();
// BUG: express.json() consumes raw body before HMAC reads it.
app.use(express.json());

app.post("/webhooks/square", async (req, res) => {
  const sig = (req.header("X-Square-HmacSha256-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  const expected = crypto
    .createHmac("sha256", process.env.SQUARE_SIGNATURE_KEY ?? "")
    .update(url + JSON.stringify(req.body))
    .digest("base64");
  if (sig !== expected) return res.status(403).end();
  res.status(200).end();
});

app.listen(3000);
