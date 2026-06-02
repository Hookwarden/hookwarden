# HN — Show HN draft

> Posting is window-gated (2026-08-01/02), after Phases 23/24/25 are confirmed
> prod-live. Draft only.

**Title:** Show HN: hookwarden — first MCP server doing webhook HMAC verification + EU AI Act Annex III evidence pack

**Body:**

hookwarden is an open-source scanner (Apache 2.0) that finds webhook handlers a
forged payload could slip past — the ones that parse `req.body` before checking
the signature. It runs locally and deterministically: `npx hookwarden scan`,
zero traffic to us, JS/TS/Python/PHP.

Two things are new in v0.8 and are why I'm posting:

1. **An MCP server that enforces, not reports.** Most compliance-adjacent MCP
   servers let an AI client *query* state. Ours lets the client *verify*: scan a
   handler for a missing-verification bug, and verify an evidence pack's signed
   hash chain offline — `verify_audit_chain` runs the same byte-for-byte check an
   auditor would, with no network call.

2. **An EU AI Act Annex III evidence pack.** The v1.1 pack tags the high-risk-AI
   classification next to SOC 2 + ISO 27001 mappings, with a tamper-evident hash
   chain and an embedded signing key so you can verify it with no AWS access.
   There's a real sample you can download and run the verifier against:
   https://hookwarden.dev/eu-ai-act

The agentic-callback rules (n8n + Anthropic Agent SDK) came out two weeks after
the Cisco Talos report on n8n webhooks being abused as an attack channel — agent
platforms accept untrusted callbacks the same way a Stripe handler does, and the
same class of bug applies.

The CLI is free forever. Happy to answer questions about the engine's
three-state model (verified / not-verified / manual-review) — keeping the
false-positive rate under 5% is the whole game.

Repo: https://github.com/Hookwarden/hookwarden
