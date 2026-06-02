# X — thread draft

> Posting is window-gated (2026-08-01/02), after Phases 23/24/25 are confirmed
> prod-live. Draft only. Replace [HN_LINK] / [DEVTO_LINK] at post time.

**1/**
Webhook integrity. From first line to final audit.

hookwarden v0.8 is out — the open-source scanner that finds every webhook handler
a forged payload could slip past, now with an MCP server and an EU AI Act Annex
III evidence pack. 🧵

**2/**
The bug we hunt: a handler that parses `req.body` before it verifies the
signature. Same vulnerability in a Stripe handler or an n8n agent node.

`npx hookwarden scan` — local, deterministic, zero traffic to us. JS/TS/Python/PHP.

**3/**
First MCP server that *enforces* webhook HMAC verification, not just reports it.

Your AI client can scan a handler for the missing-verification bug AND verify an
evidence pack's signed hash chain offline — `verify_audit_chain`, no network call.

**4/**
Two weeks after Cisco Talos documented n8n webhooks being abused as an attack
channel, we shipped the agentic-callback ruleset (n8n + Anthropic Agent SDK).

It flags unverified agent/tool sinks and stays silent on signature-verified shapes.

**5/**
The v1.1 evidence pack tags the EU AI Act Annex III high-risk classification next
to SOC 2 + ISO 27001 — ahead of the 2026-08-02 binding date.

KMS-signed, offline-verifiable, embedded key. Download a real one + run the
verifier: hookwarden.dev/eu-ai-act

**6/**
CLI is free forever, Apache 2.0.

Show HN: [HN_LINK]
The rule pack story (dev.to): [DEVTO_LINK]
Repo: github.com/Hookwarden/hookwarden
