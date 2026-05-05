import { verifyRequestSignature } from "@slack/events-api";
import express from "express";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/slack/events", async (req, res) => {
  const requestSignature = (req.header("X-Slack-Signature") ?? "") as string;
  const requestTimestamp = Number(req.header("X-Slack-Request-Timestamp") ?? "0");
  const body = (req.body as Buffer).toString("utf8");
  const valid = verifyRequestSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? "",
    requestSignature,
    requestTimestamp,
    body,
  });
  if (!valid) return res.status(403).end();
  res.status(200).send("");
});

app.listen(3000);
