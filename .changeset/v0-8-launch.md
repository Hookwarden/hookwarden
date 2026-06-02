---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
"@hookwarden/fix": minor
"@hookwarden/github-action": minor
"hookwarden": minor
---

v0.8 launch — webhook integrity, from first line to final audit.

This is the stable v0.8 cut of the CLI + engine + rules cluster. It rolls up the
v0.8 milestone surface: the n8n agentic-callback ruleset (detecting unverified
agent/tool webhook sinks, shipped after the Cisco Talos n8n abuse report), the
Anthropic Agent SDK tool-callback ruleset, and the `compliance_mappings` schema
(SOC 2 + ISO 27001 + EU AI Act Annex III + NIST AI RMF) surfaced in
`hookwarden --version --verbose`, with the v1.1 evidence pack carrying the EU AI
Act Annex III high-risk classification and an embedded offline-verifiable
signing key.

The MCP server shipped earlier in the v0.8 cycle and versions independently of
this fixed cluster, so it is intentionally not part of this changeset.
