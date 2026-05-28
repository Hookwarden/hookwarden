import crypto from "node:crypto";
import express, { type Request, type Response } from "express";

const app = express();
// BUG: express.json() consumes raw bytes before HMAC reads them.
app.use(express.json());

function verifyStripe(body: unknown, headerSig: string): boolean {
  const expected = crypto
    .createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .update(JSON.stringify(body))
    .digest("hex");
  return expected === headerSig;
}

app.post("/webhooks/stripe", (req: Request, res: Response) => verifyStripe(req.body, req.header("stripe-signature") ?? "") ? res.status(200).end() : res.status(403).end());

app.listen(3000);
