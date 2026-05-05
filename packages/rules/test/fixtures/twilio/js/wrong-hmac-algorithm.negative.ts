import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post("/webhooks/twilio", async (req, res) => {
  const sig = (req.header("X-Twilio-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  // CORRECT: sha1 matches Twilio's webhook signing algorithm.
  const expected = crypto
    .createHmac("sha1", process.env.TWILIO_AUTH_TOKEN ?? "")
    .update(url)
    .digest("base64");
  if (
    !crypto.timingSafeEqual(Buffer.from(sig, "base64"), Buffer.from(expected, "base64"))
  ) {
    return res.status(403).end();
  }
  res.status(200).send("<Response/>");
});

app.listen(3000);
