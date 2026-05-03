<p align="center">
  <img src="./assets/brand/social/readme-banner.svg" alt="hookwarden" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/v/hookwarden?color=6366F1&label=npm" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-6366F1" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-6366F1" alt="Node 22+" />
</p>

**hookwarden** is a webhook security audit CLI. It finds signature-verification bugs in JavaScript, TypeScript, and Python codebases — locally, deterministically, in under five minutes.

```sh
npx hookwarden@latest scan
```

## Why

Most webhook bugs aren't in delivery — they're in verification. A handler that accepts an unsigned payload, compares HMACs with `==`, or skips the signature check on a "test" path will silently route attacker traffic into your business logic. hookwarden grep-walks your repo, parses every webhook handler, and reports each one as **verified**, **not-verified**, or **manual-review**, with the exact file and line.

No traffic leaves your machine. No telemetry. No SaaS sign-up. Just the scanner.

## Features

- **Provider-aware rules** — Stripe, GitHub (more in Phase 6: Shopify, Twilio, Slack, Square, Adyen, Zendesk, Mailgun, SendGrid)
- **Three-state verdicts** — distinguishes confirmed bugs from "needs human review" so you can triage
- **CI-first outputs** — JSON envelope, SARIF 2.1.0 (uploads cleanly to GitHub Code Scanning), 0/1/2/3/4 exit code matrix
- **Suppression that scales** — `// hookwarden-disable-next-line <rule>`, `.hookwardenignore` (gitignore syntax), and `--baseline write` for non-greenfield adoption
- **`--diff-only`** — scan only files changed against the PR base
- **Zero-network bundle** — verified at release time; the published tarball cannot reference `http`, `axios`, `node-fetch`, or any analytics SDK

## Documentation

[hookwarden.dev](https://hookwarden.dev)

## License

Apache 2.0. The CLI, engine, and rule packs are open source. The hosted SaaS tier (continuous monitoring, leak scanning, secret rotation, SOC 2 evidence) is closed and lives in a separate repo.

Brand assets and the canonical mark live at [`assets/brand/`](./assets/brand/).
