import crypto from "node:crypto";
import express from "express";

const app = express();
// BUG: express.json() consumes raw body before HMAC reads it.
app.use(express.json());

app.post("/slack/events", async (req, res) => {
  const sig = (req.header("X-Slack-Signature") ?? "") as string;
  const ts = (req.header("X-Slack-Request-Timestamp") ?? "") as string;
  const expected = `v0=${crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET ?? "")
    .update(`v0:${ts}:${JSON.stringify(req.body)}`)
    .digest("hex")}`;
  if (sig !== expected) return res.status(403).end();
  res.status(200).send("");
});

app.listen(3000);
