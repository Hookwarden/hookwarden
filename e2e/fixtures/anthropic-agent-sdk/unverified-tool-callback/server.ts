// Anthropic Agent SDK attack-surface fixture — an Express service exposing a webhookish
// agent-callback route whose @anthropic-ai/claude-agent-sdk tool() handler acts on its
// UNVERIFIED `args` payload at a side-effect sink. No HMAC verification of args.signature
// precedes the sink, so an attacker who POSTs to the public callback URL drives the agent
// tool with attacker-controlled input — the Microsoft "prompts become shells" agentic RCE
// surface (OWASP Agentic ASI07).
//
// anthropic-agent-sdk/tool-callback-no-verification (critical) must fire here.
import express from "express";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Stand-in for the LangChain agent/tool chain the SDK tool() handler drives — the engine's
// anthropic-agent-sdk catalog lists `chain.invoke` as an agentic side-effect sink.
declare const chain: { invoke(input: unknown): Promise<unknown> };

// The custom tool the agent loop can call (createSdkMcpServer + tool() — the SDK content the
// provider attribution sniffs for). SINK: args.event drives an agent invocation WITHOUT
// verifying args.signature via HMAC first.
const handleProviderEvent = tool(
  "handle_provider_event",
  "Process an incoming provider webhook/callback event",
  { event: z.string(), signature: z.string().optional(), raw_body: z.string().optional() },
  async (args: { event: string; signature?: string; raw_body?: string }) =>
    chain.invoke(args.event),
);
createSdkMcpServer({ name: "events", version: "1.0.0", tools: [handleProviderEvent] });

const app = express();
app.use(express.json());

// Webhookish agent-callback route — feeds the UNVERIFIED body straight into the agent sink.
app.post("/webhooks/anthropic-agent", async (req, res) => {
  // SOURCE: the unverified inbound callback payload.
  const body = req.body as { event: string; signature?: string; raw_body?: string };
  // SINK: the agent/tool is invoked on the unverified body with NO HMAC check first.
  const result = await chain.invoke(body.event);
  res.json({ result });
});

app.listen(3000);
