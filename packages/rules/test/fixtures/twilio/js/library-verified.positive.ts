import express from "express";
import twilio from "twilio";

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post("/webhooks/twilio", async (req, res) => {
  const signature = (req.header("X-Twilio-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN ?? "",
    signature,
    url,
    req.body,
  );
  if (!valid) return res.status(403).end();
  res.status(200).send("<Response/>");
});

app.listen(3000);
