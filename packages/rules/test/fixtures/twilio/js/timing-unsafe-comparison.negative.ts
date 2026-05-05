import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post("/webhooks/twilio", async (req, res) => {
  const sig = (req.header("X-Twilio-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  const params = Object.keys(req.body)
    .sort()
    .map((k) => `${k}${req.body[k]}`)
    .join("");
  const expected = crypto
    .createHmac("sha1", process.env.TWILIO_AUTH_TOKEN ?? "")
    .update(url + params)
    .digest("base64");
  const sigBuf = Buffer.from(sig, "base64");
  const expBuf = Buffer.from(expected, "base64");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(403).end();
  }
  res.status(200).send("<Response/>");
});

app.listen(3000);
