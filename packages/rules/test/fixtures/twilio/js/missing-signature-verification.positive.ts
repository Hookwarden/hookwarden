import express from "express";

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post("/webhooks/twilio", async (req, res) => {
  // BUG: no validateRequest, no manual HMAC; X-Twilio-Signature ignored.
  const event = req.body;
  console.log("Twilio event:", event.MessageSid);
  res.status(200).send("<Response/>");
});

app.listen(3000);
