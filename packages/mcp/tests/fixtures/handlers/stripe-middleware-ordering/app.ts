// Wave 0 fixture for Plan 23-05 scan_handler SC #1 — the canonical
// Stripe middleware-ordering bug rendered across two files.
//
// The bug: `app.use(express.json())` registered BEFORE the webhook route
// mount consumes the raw body, so by the time
// stripe.webhooks.constructEvent(req.body, sig, secret) runs it sees the
// already-parsed JSON object instead of the raw bytes the HMAC was computed
// over. Verification silently fails on every event in production.
//
// Cross-file detection: the route is in routes/webhook.ts but the
// middleware ordering only becomes visible by walking the middleware_chain
// extracted from this entrypoint. scan_handler must follow the import in
// `webhookRouter` and resolve the chain across both files.
import express from "express";
import { webhookRouter } from "./routes/webhook";

const app = express();
app.use(express.json());
app.use("/webhooks/stripe", webhookRouter);

app.listen(3000);
