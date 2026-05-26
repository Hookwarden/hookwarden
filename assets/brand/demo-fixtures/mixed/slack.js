// Slack events webhook — HMAC verified over the raw body, but the request
// timestamp is never gated by a tolerance window, so replays are unbounded.
const crypto = require('node:crypto');
const express = require('express');

const app = express();

app.post('/webhooks/slack', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.header('X-Slack-Signature') ?? '';
  const ts = req.header('X-Slack-Request-Timestamp') ?? '';
  const body = req.body.toString('utf8');
  const expected = `v0=${crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET ?? '')
    .update(`v0:${ts}:${body}`)
    .digest('hex')}`;
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return res.status(403).end();
  }
  res.status(200).send('');
});

app.listen(3001);
