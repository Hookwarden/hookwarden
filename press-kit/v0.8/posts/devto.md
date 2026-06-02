# dev.to — long-form draft

> Posting is window-gated (2026-08-01/02), after Phases 23/24/25 are confirmed
> prod-live. Draft only.

**Title:** We shipped two weeks after the Talos n8n abuse report — here's the rule pack

**Tags:** security, webhooks, ai, compliance

---

In late 2025, Cisco Talos documented something a lot of teams had been quietly
worried about: n8n webhooks were being actively abused as a delivery channel —
untrusted callbacks hitting agent workflows that acted on the body without ever
verifying a signature.

If you've used hookwarden, you already know that's the exact bug class the engine
was built to find. A webhook handler that does `JSON.parse(req.body)` before it
checks the HMAC is the same vulnerability whether the consumer is a Stripe
fulfillment handler or an n8n agent node. So two weeks after the report, we
shipped an agentic-callback rule pack.

## What "agentic callback" means for the scanner

Agent platforms accept untrusted input the same way any webhook endpoint does —
they just route it into a tool call instead of a database write. The new rules
detect unverified agent/tool sinks:

- **n8n** — `getBodyData()`, `$json`, `items[0].json` reaching an agent/tool
  call, in `*.workflow.json` files and community custom nodes.
- **Anthropic Agent SDK** — a `tool_result` webhook callback that the agent loop
  acts on without HMAC verification.

And — this is the part that keeps the false-positive rate down — they stay
**silent** on the mitigated shape. If the body is verified before it's used, the
handler is `verified` and you hear nothing.

## From a finding to an auditor-ready pack

Finding the bug is half of it. v0.8 carries the same finding the rest of the
way: a v1.1 evidence pack with a tamper-evident hash chain, SOC 2 + ISO 27001
control mappings, and — ahead of the 2026-08-02 binding date — the EU AI Act
Annex III high-risk classification.

The pack is KMS-signed and **offline-verifiable**. The signing public key is
embedded, so the verifier confirms the hash chain and the signature with no AWS
call. There's a real sample at https://hookwarden.dev/eu-ai-act — download it and
run:

```
node verify-evidence-pack.mjs --pack sample-pack.json
```

## And an MCP server that enforces

The new `@hookwarden/mcp` server lets an AI client do both halves: scan a handler
for the missing-verification bug, and `verify_audit_chain` on an evidence pack —
the same byte-for-byte check, in your editor.

The CLI is free and Apache 2.0: `npx hookwarden scan`. Repo:
https://github.com/Hookwarden/hookwarden
