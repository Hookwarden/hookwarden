<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/Hookwarden/hookwarden@main/assets/brand/social/readme-banner.svg" alt="hookwarden" width="100%" />
</p>

<p align="center">
  <strong>The first MCP server doing webhook signature verification.</strong><br />
  Local. Deterministic. Zero network. JS / TS / Python — 21 providers — 3-state verdicts.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@hookwarden/mcp"><img src="https://img.shields.io/npm/v/@hookwarden/mcp?color=6366F1&label=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-6366F1?style=flat-square" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-6366F1?style=flat-square" alt="Node 22+" />
  <img src="https://img.shields.io/badge/MCP-2025--06--18-6366F1?style=flat-square" alt="MCP spec 2025-06-18" />
</p>

## What it does

`@hookwarden/mcp` exposes hookwarden's deterministic webhook-verification engine as MCP tools. AI coding agents — Claude Desktop, Cursor, Continue, and apps built on the Anthropic Agent SDK — get two tools:

- **`scan_handler`** — scan pasted webhook handler code and get back a structured finding (`verified` / `not-verified` / `manual-review`) for Stripe, GitHub, Shopify, Twilio, and 17 other providers.
- **`verify_audit_chain`** — verify a hookwarden evidence pack's hash chain + KMS-signed Merkle roots **offline** (no network, no auth), returning `{ valid, broken_at_row, signatures_verified }`.

Runs entirely client-side. Zero network egress from the MCP process. Zero auth. The same engine the [hookwarden CLI](https://www.npmjs.com/package/hookwarden) ships — same rule pack, same content hashes, end-to-end provenance.

## Install in one command

```bash
npx @hookwarden/mcp init
```

That command detects your installed MCP clients (Claude Desktop / Cursor / Continue), prints a per-OS summary table, and writes the canonical config to each one. `.bak` files land alongside every config it touches. Restart the relevant client and `scan_handler` + `verify_audit_chain` appear in the tool list.

Pass `--all` for non-interactive use, `--dry-run` to preview, `--force` to overwrite an existing `mcpServers.hookwarden` entry, or `--clients claude-desktop,cursor` to limit the set.

## Manual configuration

If you'd rather not run the init helper, write the config by hand.

### Claude Desktop

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hookwarden": {
      "command": "npx",
      "args": ["-y", "@hookwarden/mcp"]
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` — same shape as Claude Desktop:

```json
{
  "mcpServers": {
    "hookwarden": {
      "command": "npx",
      "args": ["-y", "@hookwarden/mcp"]
    }
  }
}
```

### Continue.dev

Continue uses a per-server file. Write `~/.continue/mcpServers/hookwarden.yaml`:

```yaml
name: hookwarden
command: npx
args: [-y, "@hookwarden/mcp"]
```

### Anthropic Agent SDK

The Agent SDK is programmatic — there's no config file to edit. Drop this into your code:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Audit this webhook handler for missing signature verification...",
  options: {
    mcpServers: {
      hookwarden: {
        command: "npx",
        args: ["-y", "@hookwarden/mcp"],
      },
    },
  },
})) {
  console.log(message);
}
```

The init helper does not write here — the SDK integration is code, not config.

## The `scan_handler` tool

### Inputs

| Field | Type | Notes |
|---|---|---|
| `code` | string | Single-blob mode. Defaults to TypeScript; override with `language`. Mutually exclusive with `files`. |
| `files` | `Record<string, string>` | Multi-file mode. Keys are virtual file paths; language inferred from extension. |
| `language` | `"js" \| "ts" \| "python"` | Optional. `"php"` returns `language_not_in_preview` — PHP support ships in v0.8.1. |
| `provider` | string | Optional. Case-insensitive (`"stripe"` = `"Stripe"`). `unknown_provider` if not in the rule pack. |

### Output

Returns `Tool.result` with `structuredContent` first-class (MCP spec 2025-06-18) plus a companion stringified-JSON text block for backwards compatibility:

```json
{
  "verdict_summary": { "verified": 0, "not_verified": 1, "manual_review": 0, "parse_error": 0 },
  "findings": [
    {
      "rule_id": "stripe/missing-signature-verification",
      "provider": "stripe",
      "severity": "critical",
      "verdict": "not-verified",
      "file": "__handler.ts",
      "line_start": 7,
      "line_end": 9,
      "message": "Webhook handler reads req.body without calling stripe.webhooks.constructEvent...",
      "provider_docs_url": "https://stripe.com/docs/webhooks",
      "references": [
        "https://www.svix.com/blog/common-failure-modes-for-webhook-signatures/",
        "https://hookdeck.com/webhooks/guides/webhook-security-vulnerabilities-guide"
      ],
      "rule_pack_version": "0.7.2"
    }
  ],
  "scan_metadata": {
    "engine_version": "0.7.2",
    "rule_pack_version": "0.7.2",
    "rule_pack_content_hash": "938f7565e29f19e0cbd34594731d1de2b0ffd40ee87aacaa8be2435fc1f47f32"
  }
}
```

### Verdict vocabulary

| Verdict | Meaning |
|---|---|
| `verified` | Engine proved the handler verifies signatures via the provider's documented SDK call. |
| `not-verified` | Engine proved the handler does NOT verify signatures (or verifies after side effects). |
| `manual-review` | Engine has structural evidence but can't decide without human eyes — review the snippet. |

Same 3-state vocabulary as the CLI. No remapping in the MCP layer.

### Error payloads (`isError: true`)

| Error | Trigger |
|---|---|
| `empty_input` | Neither `code` nor `files` provided. |
| `exclusive_input_modes` | Both `code` and `files` provided — pick one. |
| `language_not_in_preview` | `language: "php"` — PHP ships in v0.8.1. Suggestion: `npx hookwarden scan`. |
| `unsupported_language` | `language` outside the known set. |
| `unknown_provider` | `provider` not in the rule pack. Response includes the sorted known list. |
| `engine_drift` / `rules_drift` | Boot or call-time drift — see [drift-detection](https://docs.hookwarden.dev/mcp/drift-detection). |

Parse failures don't crash the transport — they emit as `rule_id: "engine/parse-error"` findings with severity `high` and increment `verdict_summary.parse_error`.

## The `verify_audit_chain` tool

Verify a hookwarden evidence pack's integrity **offline** — no network, no AWS, no credentials. "Verify the chain without trusting hookwarden." The tool walks the per-row hash chain, roundtrips the manifest hash, and — for v1.1 packs that embed the signing CMK's SPKI public key — verifies the ECDSA-P256 (`MessageType:DIGEST`) Merkle-root + manifest signatures with `node:crypto`.

### Inputs

| Field | Type | Notes |
|---|---|---|
| `evidence_pack_json` | string | The full evidence-pack JSON (the file hookwarden's evidence export produces). Both v1.0 and v1.1 packs are accepted. |

### Output

```json
{
  "valid": true,
  "broken_at_row": null,
  "signatures_verified": 2
}
```

| Field | Meaning |
|---|---|
| `valid` | `true` iff the hash chain is intact AND the manifest hash roundtrips AND every signature that could be verified offline verified. |
| `broken_at_row` | The `seq` of the first row whose chain hash didn't match, or `null` if the chain is intact. Signature validity is independent of chain integrity. |
| `signatures_verified` | Count of offline-verified signatures: N Merkle-root signatures + 1 manifest signature (N+1). `0` for v1.0 packs (no embedded public key) — the tool emits a `signatures not verifiable offline (v1.0 pack)` note instead of failing. |

### Trust model

The v1.1 pack carries its own SPKI public key. The signature proves the pack was not altered after signing **by the holder of that key** — it is trust-on-first-use. To pin trust to a specific signer out-of-band, an auditor can cross-check `signature.signing_cmk_arn` against AWS KMS `GetPublicKey` and confirm the embedded SPKI key matches. Malformed pack JSON returns `isError: true` (`error: "invalid_pack_json"`) — the tool never throws past its boundary.

This tool imports only `@hookwarden/canonical-json` (the shared RFC 8785 byte-equality anchor) + `node:crypto`. It does **not** load the engine or rule pack and does not run the drift gate.

## Integrity claims

- **Zero outbound TCP** — the published tarball passes `pnpm inspect-bundle`, a structural CI gate that rejects any source-file import of HTTP clients (`node:http`, `axios`, `undici`, etc.) and any direct dependency outside the documented allowlist.
- **Drift detection** — every `scan_handler` call cross-checks the runtime-resolved engine + rule-pack hashes against the build-time `dist/build-manifest.json`. Mismatch returns `isError: true` with structured `engine_drift` / `rules_drift` payload. No env-var opt-out. See [drift-detection](https://docs.hookwarden.dev/mcp/drift-detection) — including the v0.8.0 engine-content-hash limitation.
- **No telemetry** — the tarball declares no analytics or tracking SDKs (`@datadog/*`, `@segment/*`, `@sentry/*`, etc.) in `dependencies` or transitively in source-file imports.
- **Open source** — Apache-2.0 at `Hookwarden/hookwarden/packages/mcp/`. Engine + rule pack land in the same monorepo and ship under the same license.

## Links

- [Documentation](https://docs.hookwarden.dev/mcp/getting-started) — getting started, tool surface reference, drift detection
- [npm package](https://www.npmjs.com/package/@hookwarden/mcp)
- [GitHub repository](https://github.com/Hookwarden/hookwarden)
- [Apache-2.0 License](https://github.com/Hookwarden/hookwarden/blob/main/LICENSE)

---

Copyright 2026 Hookwarden contributors. Apache License 2.0.
