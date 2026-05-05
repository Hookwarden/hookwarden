import express from "express";
import twilio from "twilio";

const app = express();
// CORRECT: form-urlencoded parser; Twilio's default content type.
app.use(express.urlencoded({ extended: false }));

app.post("/webhooks/twilio", async (req, res) => {
  const sig = (req.header("X-Twilio-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN ?? "",
    sig,
    url,
    req.body,
  );
  if (!valid) return res.status(403).end();
  res.status(200).send("<Response/>");
});

app.listen(3000);
