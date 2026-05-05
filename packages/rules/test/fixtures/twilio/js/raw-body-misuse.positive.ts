import crypto from "node:crypto";
import express from "express";

const app = express();
// BUG: express.json() parses Twilio's form-urlencoded body incorrectly; canonical-string sort breaks.
app.use(express.json());

app.post("/webhooks/twilio", async (req, res) => {
  const sig = (req.header("X-Twilio-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  const expected = crypto
    .createHmac("sha1", process.env.TWILIO_AUTH_TOKEN ?? "")
    .update(url + JSON.stringify(req.body))
    .digest("base64");
  if (sig !== expected) return res.status(403).end();
  res.status(200).send("<Response/>");
});

app.listen(3000);
