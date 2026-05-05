import express from "express";

const app = express();
app.use(express.json());

app.post("/webhooks/shopify", async (req, res) => {
  // BUG: no HMAC verification; X-Shopify-Hmac-Sha256 header ignored.
  const order = req.body;
  console.log("Shopify order:", order.id);
  res.status(200).end();
});

app.listen(3000);
