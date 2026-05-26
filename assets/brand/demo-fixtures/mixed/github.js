// GitHub webhook — express.json() consumes the raw body before the HMAC
// reads it, so the signature can never verify against the original bytes.
const crypto = require('node:crypto');
const express = require('express');

const app = express();
// BUG: express.json() consumes raw body before the signature is checked.
app.use(express.json());

app.post('/webhooks/github', (req, res) => {
  const sig = req.header('X-Hub-Signature-256') ?? '';
  const expected = `sha256=${crypto
    .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET ?? '')
    .update(JSON.stringify(req.body))
    .digest('hex')}`;
  if (sig !== expected) return res.status(401).end();
  res.status(202).send('');
});

app.listen(3002);
