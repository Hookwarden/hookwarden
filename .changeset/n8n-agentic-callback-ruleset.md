---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
"hookwarden": minor
---

Add the n8n agentic-callback ruleset. The engine gains a workflow-JSON adapter that ingests `*.workflow.json` files and n8n community custom-nodes (`package.json#n8n.nodes`, `INodeType`/`IWebhookFunctions` sources), synthesizing handler models from n8n trigger/webhook nodes. A new n8n rule pack detects unverified-body agent/tool sinks (VAS/BYP on `getBodyData()`, `$json`, `items[0].json` reaching agent-tool calls) while staying silent on mitigated, signature-verified shapes. The `hookwarden` CLI now scans n8n projects end-to-end (`scan` surfaces n8n findings and malformed-workflow parse errors).
