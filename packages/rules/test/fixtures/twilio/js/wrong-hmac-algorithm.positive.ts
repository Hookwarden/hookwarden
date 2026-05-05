import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post("/webhooks/twilio", async (req, res) => {
  const sig = (req.header("X-Twilio-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  // BUG: sha256 instead of sha1 — Twilio webhooks remain on legacy SHA-1.
  const expected = crypto
    .createHmac("sha256", process.env.TWILIO_AUTH_TOKEN ?? "")
    .update(url)
    .digest("base64");
  if (sig !== expected) return res.status(403).end();
  res.status(200).send("<Response/>");
});

app.listen(3000);
