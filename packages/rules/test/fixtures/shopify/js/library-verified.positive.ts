import express from "express";
import { shopifyApi } from "@shopify/shopify-api";

// Configuration intentionally minimized for a fixture — full app would set apiVersion, hostName, etc.
const shopify = shopifyApi({
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  // biome-ignore lint/suspicious/noExplicitAny: fixture sample, not production config
} as any);

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/webhooks/shopify", async (req, res) => {
  const ok = await shopify.webhooks.validate({
    rawBody: req.body,
    // biome-ignore lint/suspicious/noExplicitAny: fixture sample
    rawRequest: req as any,
    // biome-ignore lint/suspicious/noExplicitAny: fixture sample
    rawResponse: res as any,
  });
  if (!ok.valid) return res.status(403).end();
  res.status(200).end();
});

app.listen(3000);
