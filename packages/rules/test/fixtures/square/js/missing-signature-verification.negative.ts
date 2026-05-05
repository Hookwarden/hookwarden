import express from "express";
import { WebhooksHelper } from "square";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/webhooks/square", async (req, res) => {
  const sig = (req.header("X-Square-HmacSha256-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  const valid = WebhooksHelper.verifySignature(
    (req.body as Buffer).toString("utf8"),
    sig,
    process.env.SQUARE_SIGNATURE_KEY ?? "",
    url,
  );
  if (!valid) return res.status(403).end();
  res.status(200).end();
});

app.listen(3000);
