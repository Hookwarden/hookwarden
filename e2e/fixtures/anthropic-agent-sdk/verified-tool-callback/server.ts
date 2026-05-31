// Anthropic Agent SDK MITIGATED fixture — identical to the attack-surface fixture except the
// handler verifies an HMAC over the raw callback body BEFORE the agent sink. The
// crypto.createHmac + crypto.timingSafeEqual check runs first; only a verified request reaches
// the agent invocation.
//
// anthropic-agent-sdk/tool-callback-no-verification AND every anthropic-agent-sdk baseline must
// STAY SILENT here (SC#2 zero-FP on the mitigated shape).
import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

declare const chain: { invoke(input: unknown): Promise<unknown> };

const signingSecret = process.env.ANTHROPIC_WEBHOOK_SECRET ?? "";

const handleProviderEvent = tool(
  "handle_provider_event",
  "Process an incoming provider webhook/callback event",
  { event: z.string(), signature: z.string(), raw_body: z.string() },
  async (args: { event: string; signature: string; raw_body: string }) => {
    // VERIFY FIRST: HMAC over the raw body, constant-time compared, before any side effect.
    const expected = createHmac("sha256", signingSecret).update(args.raw_body).digest();
    const provided = Buffer.from(args.signature, "hex");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return { content: [{ type: "text", text: "invalid signature" }], isError: true };
    }
    return chain.invoke(args.event);
  },
);
createSdkMcpServer({ name: "events", version: "1.0.0", tools: [handleProviderEvent] });

const app = express();
app.use(express.json());

// Webhookish agent-callback route — verifies the HMAC over the raw body BEFORE the agent sink.
app.post("/webhooks/anthropic-agent", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = req.body as Buffer;
  const signature = String(req.headers["x-signature"] ?? "");
  // VERIFY FIRST: compute the HMAC over the raw bytes and constant-time compare.
  const expected = createHmac("sha256", signingSecret).update(rawBody).digest();
  const provided = Buffer.from(signature, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  // Only a verified request reaches the agent.
  const event = JSON.parse(rawBody.toString("utf8")) as { event: string };
  const result = await chain.invoke(event.event);
  res.json({ result });
});

app.listen(3000);
