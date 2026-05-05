import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/webhooks/square", async (req, res) => {
  const sig = (req.header("X-Square-HmacSha256-Signature") ?? "") as string;
  const url = `https://example.com${req.originalUrl}`;
  const expected = crypto
    .createHmac("sha256", process.env.SQUARE_SIGNATURE_KEY ?? "")
    .update(url + (req.body as Buffer).toString("utf8"))
    .digest("base64");
  if (
    !crypto.timingSafeEqual(Buffer.from(sig, "base64"), Buffer.from(expected, "base64"))
  ) {
    return res.status(403).end();
  }
  res.status(200).end();
});

app.listen(3000);
