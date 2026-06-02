# hookwarden v0.8 — key facts

## Boilerplate

hookwarden is a webhook security and lifecycle tool for engineering teams. The
free, open-source CLI (`npx hookwarden scan`, Apache 2.0) detects
signature-verification bugs in JS/TS/Python/PHP codebases, locally and
deterministically, with zero traffic routed through a third party. The paid SaaS
layer adds continuous monitoring, automated dual-secret rotation, webhook-secret
leak scanning, and signed evidence packs for SOC 2, ISO 27001, and EU AI Act
Annex III compliance.

## One-liner

hookwarden finds every webhook your code forgot to verify — and gives your
auditor a signed pack to prove the rest hold.

## Positioning

Webhook *integrity*, from first line to final audit. Not a proxy, not a gateway —
the integrity layer that verifies the seam where untrusted input enters.

## Shipped versions (confirm at publish time with `npm view <pkg> version`)

| Package | Channel | Notes |
|---------|---------|-------|
| `hookwarden` (CLI) | npm | v0.8 stable cut from the 0.8.x line |
| `@hookwarden/engine`, `@hookwarden/rules`, `@hookwarden/fix` | npm | fixed cluster, versioned together |
| `@hookwarden/github-action` | npm + action mirror | CI gate |
| `@hookwarden/mcp` | npm — already live (latest 0.8.7) | versions independently of the CLI cluster |

Distribution channels: npm + PyPI + Homebrew + Scoop + GitHub Releases + the
hookwarden-action mirror.

## Links

- Repo: https://github.com/Hookwarden/hookwarden
- Docs: https://docs.hookwarden.dev
- Annex III evidence pack: https://hookwarden.dev/eu-ai-act
- MCP registry entry: io.github.Hookwarden/mcp
- License: Apache 2.0 (CLI + engine + rules); SaaS is closed.

## Facts an editor can quote

- First MCP server that *enforces* webhook HMAC verification (not just reports).
- Agentic-callback ruleset shipped two weeks after the Cisco Talos n8n abuse report.
- v1.1 evidence pack tags EU AI Act Annex III high-risk classification + SOC 2 + ISO 27001, ahead of the 2026-08-02 Annex III binding date.
- Evidence packs are KMS-signed and offline-verifiable — no network call, no vendor trust required.
