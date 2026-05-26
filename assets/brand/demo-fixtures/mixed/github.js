// GitHub webhook — HMAC computed over the raw body, but the signature is
// compared with a plain `===`, which leaks timing and is exploitable.
const crypto = require('node:crypto');
const express = require('express');

const app = express();

app.post('/webhooks/github', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.header('X-Hub-Signature-256') ?? '';
  const expected = `sha256=${crypto
    .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET ?? '')
    .update(req.body)
    .digest('hex')}`;
  // BUG: plain === leaks timing — should be crypto.timingSafeEqual.
  if (expected === sig) {
    return res.status(202).end();
  }
  res.status(401).end();
});

app.listen(3002);
