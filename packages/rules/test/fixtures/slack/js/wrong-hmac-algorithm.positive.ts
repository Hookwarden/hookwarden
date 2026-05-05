import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/slack/events", async (req, res) => {
  const sig = (req.header("X-Slack-Signature") ?? "") as string;
  const ts = (req.header("X-Slack-Request-Timestamp") ?? "") as string;
  const body = (req.body as Buffer).toString("utf8");
  // BUG: sha512 instead of sha256 — Slack signs with HMAC-SHA256.
  const expected = `v0=${crypto
    .createHmac("sha512", process.env.SLACK_SIGNING_SECRET ?? "")
    .update(`v0:${ts}:${body}`)
    .digest("hex")}`;
  if (sig !== expected) return res.status(403).end();
  res.status(200).send("");
});

app.listen(3000);
