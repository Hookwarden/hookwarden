<p align="center">
  <img src="./assets/brand/social/readme-banner.svg" alt="hookwarden" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-pre--release-6366F1" alt="Status: pre-release" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-6366F1" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-6366F1" alt="Node 22+" />
</p>

**hookwarden** is a webhook security audit CLI. It finds signature-verification bugs in JavaScript, TypeScript, and Python codebases — locally, deterministically, in under five minutes.

> **Status:** Pre-release. The CLI is not yet on npm. v0.4 — CI-grade JSON/SARIF outputs, the full exit-code matrix, suppressions, baseline mode, and `--diff-only` — is in active development. Star the repo to get notified when it ships.

## Why

Most webhook bugs aren't in delivery — they're in verification. A handler that accepts an unsigned payload, compares HMACs with `==`, or skips the signature check on a "test" path will silently route attacker traffic into your business logic. hookwarden grep-walks your repo, parses every webhook handler, and reports each one as **verified**, **not-verified**, or **manual-review**, with the exact file and line.

No traffic leaves your machine. No telemetry. No SaaS sign-up. Just the scanner.

## Available today

- Stripe and GitHub provider rules
- Three-state verdicts (`verified` / `not-verified` / `manual-review`)
- Color-coded terminal output with file:line citations
- Gitignore-aware walker, path-based severity overrides

## Coming in v0.4

- JSON envelope (sorted keys, schema-versioned) and SARIF 2.1.0 with GitHub Code Scanning round-trip
- Full exit-code matrix (`0/1/2/3/4`) with documented precedence
- Inline disable comments, `.hookwardenignore`, and `--baseline` for non-greenfield adoption
- `--diff-only` for PR-scoped scanning
- `hookwarden.config.yaml` schema
- Verified zero-network bundle gate

After v0.4: 8 more provider rule packs (Shopify, Twilio, Slack, Square, Adyen, Zendesk, Mailgun, SendGrid) and a published <5% false-positive rate against a 200-repo OSS regression corpus.

## Documentation

[hookwarden.dev](https://hookwarden.dev)

## License

Apache 2.0. The CLI, engine, and rule packs are open source. The hosted SaaS tier (continuous monitoring, leak scanning, secret rotation, SOC 2 evidence) is closed and lives in a separate repo.

Brand assets and the canonical mark live at [`assets/brand/`](./assets/brand/).
