# hookwarden v0.8 — press one-pager

**Tagline:** Webhook integrity. From first line to final audit.

## The lead

Webhooks are the seam where untrusted input enters your system — and the one
place most teams forget to verify a signature. hookwarden is the integrity layer
for that seam: it finds every webhook handler a forged payload could slip past,
proves the ones that are verified, and carries that proof all the way to your
auditor.

The free, open-source CLI (`npx hookwarden scan`) catches every webhook
signature-verification bug in a JS/TS/Python/PHP codebase, locally, with zero
traffic routed through anyone. The SaaS keeps that integrity true in production —
continuous monitoring, automated dual-secret rotation, leak scanning, and signed
evidence packs your compliance team can hand straight to an auditor.

## The proof points

- **The first MCP server that *enforces* webhook HMAC verification.** Of the
  thousands of servers in the MCP ecosystem, the others that touch compliance
  *report* state. hookwarden's MCP server is the first to *enforce* webhook
  integrity — your AI client can scan a handler and verify an evidence pack's
  signed hash chain offline, with no network call.
- **Shipped two weeks after the Talos n8n abuse report.** When Cisco Talos
  documented active abuse of n8n webhooks as an attack channel, hookwarden
  shipped an agentic-callback ruleset that detects unverified agent/tool webhook
  sinks — across n8n and the Anthropic Agent SDK — while staying silent on
  signature-verified shapes.
- **An EU AI Act Annex III evidence pack.** Ahead of the 2026-08-02 Annex III
  binding date, the v1.1 evidence pack tags the high-risk-AI-system
  classification alongside SOC 2 + ISO 27001 control mappings. It's real and
  KMS-signed: download it, verify it offline, hand it to your auditor.

## What's in v0.8

- Open-source CLI + engine + rule pack — Apache 2.0.
- `@hookwarden/mcp` — webhook-verification + evidence-pack-verification MCP
  server (already live on npm).
- n8n + Anthropic Agent SDK agentic-callback rulesets.
- `compliance_mappings`: SOC 2, ISO 27001, EU AI Act Annex III, NIST AI RMF —
  surfaced in `hookwarden --version --verbose`.
- v1.1 evidence pack: tamper-evident hash chain + embedded offline-verifiable
  signing key + Annex III classification.

## One-liner

> hookwarden finds every webhook your code forgot to verify — and gives your
> auditor a signed pack to prove the rest hold.

## Links

- Repo: https://github.com/Hookwarden/hookwarden
- Docs: https://docs.hookwarden.dev
- Annex III evidence pack: https://hookwarden.dev/eu-ai-act
- MCP registry: io.github.Hookwarden/mcp
