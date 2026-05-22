// Canonical Express bug: express.json() registered BEFORE the Stripe webhook route consumes
// the body, so the raw bytes Stripe HMAC needs are gone by the time the handler runs.

const express = require('express');
const app = express();

// THE BUG: JSON middleware registered globally before webhook route.
app.use(express.json());

app.post('/webhooks/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = req.body;
  console.log('Got Stripe event:', event.type);
  res.json({ received: true });
});

app.listen(3000);
