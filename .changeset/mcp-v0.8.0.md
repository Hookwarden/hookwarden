---
"@hookwarden/mcp": minor
---

Introduce @hookwarden/mcp — webhook signature verification as an MCP tool.

The first MCP server doing webhook HMAC verification. Local. Deterministic. Zero network.

User-visible deliverables:

- `scan_handler` tool: pasted webhook handler code → 3-state verdict (`verified` / `not-verified` / `manual-review`) for Stripe, GitHub, Shopify, Twilio, and 17 other providers
- `npx @hookwarden/mcp init` setup helper: detects installed MCP clients (Claude Desktop / Cursor / Continue) and writes canonical config with `.bak` backups; Anthropic Agent SDK integration documented in README
- MCP-04 drift detection: every scan_handler call cross-checks engine + rule-pack content hash against build-time pin; mismatch returns structured isError payload (boot-time enforcement uses 5-line stderr message + exit 1)
- SC#4 zero-outbound-TCP CI gate: source-file regex scan + package.json deps allowlist + tarball structural assertions block any release that introduces an HTTP client or telemetry SDK

Compatibility: Requires Node 22+. Bundled with `@hookwarden/engine@0.7.0` and `@hookwarden/rules@0.7.0` (exact-pinned for drift detection).

Out of scope: PHP language support ships in v0.8.1 (mirrors v0.7 → v0.7.1 cadence). Workspace-token-gated tools (`check_secret_health`, `get_rotation_status`) deferred to v0.8.1+ per §9 Q5.

Docs: https://docs.hookwarden.dev/mcp/getting-started

Apache-2.0.
