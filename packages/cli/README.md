# hookwarden

[![npm](https://img.shields.io/npm/v/hookwarden?color=6366F1&label=npm)](https://www.npmjs.com/package/hookwarden)
[![npm downloads](https://img.shields.io/npm/dm/hookwarden?color=6366F1)](https://www.npmjs.com/package/hookwarden)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-6366F1)](https://github.com/Hookwarden/hookwarden/blob/main/LICENSE)
![Node 22+](https://img.shields.io/badge/node-%E2%89%A522-6366F1)

**Webhook security audit CLI.** Find every signature-verification bug in your codebase in under five minutes — locally, deterministically, zero-network.

```bash
npx hookwarden scan ./your-app
```

No traffic leaves your machine. No telemetry. No SaaS sign-up.

## Why

Most webhook bugs aren't in delivery — they're in verification. A handler that accepts an unsigned payload, compares HMACs with `==`, or skips the signature check on a "test" path will silently route attacker traffic into your business logic. hookwarden walks your repo, parses every webhook handler, and labels each as **verified**, **not-verified**, or **manual-review**, with the exact file and line.

The three-state verdict matters: `manual-review` is what hookwarden returns when it can't prove safety *or* unsafety from the source. It's how the false-positive rate stays honest.

## Install

```bash
# Run without install (recommended for first use):
npx hookwarden scan ./your-app

# Or install globally:
npm install -g hookwarden

# Or as a dev dependency (CI-friendly):
npm install --save-dev hookwarden
```

Requires Node 22+.

## Usage

```bash
# Color-coded terminal output
hookwarden scan ./your-app

# Machine-readable JSON envelope (sorted keys, schema-versioned)
hookwarden scan ./your-app --format json

# SARIF 2.1.0 (round-trips through GitHub Code Scanning)
hookwarden scan ./your-app --format sarif > findings.sarif

# Scope to changed files in a PR
hookwarden scan ./your-app --diff-only --diff-base origin/main

# Capture pre-existing findings as a baseline
hookwarden scan ./your-app --baseline write
# Subsequent runs auto-suppress the baselined findings
hookwarden scan ./your-app

# Set the failure threshold
hookwarden scan ./your-app --fail-on high

# List every detected webhook handler (without running rules)
hookwarden inventory ./your-app
```

### Suppressing a finding

Three ways, in order of preference:

```ts
// Inline (best for one-off cases — the comment is grep-able evidence):
// hookwarden-disable-next-line stripe/missing-signature-verification
app.post('/webhook', handler);
```

```gitignore
# .hookwardenignore (gitignore syntax — best for path-scoped suppression)
__tests__/
fixtures/**/*.spec.ts
```

```bash
# Baseline (best for adopting on a non-greenfield codebase)
hookwarden scan . --baseline write
```

A finding is suppressed when *any* of the three sources matches; `--format json` reports each suppression's source so you can audit them.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Clean — no findings at or above the configured threshold |
| 1 | Findings at or above `--fail-on` threshold |
| 2 | Engine error (parser crash, unreadable input) |
| 3 | Config error (malformed `hookwarden.config.yaml`) |
| 4 | Parse coverage below minimum |

Precedence: `3 > 2 > 4 > 1 > 0`. Use these in CI for branching logic.

### GitHub Code Scanning

Use the official Action for PR comments + SARIF upload, or call the CLI directly:

```yaml
# .github/workflows/hookwarden.yml
name: hookwarden
on: [pull_request, push]
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Hookwarden/hookwarden-action@v1
        with:
          fail-on: high
```

Or call the binary directly:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: '22' }
- run: npx hookwarden scan . --format sarif > hookwarden.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: hookwarden.sarif
```

Severity maps per the [published table](https://github.com/Hookwarden/hookwarden/blob/main/packages/cli/docs/sarif-severity-mapping.md): critical/high → `error`, medium → `warning`, low/info → `note`. Re-uploading the same scan dedups via SARIF `partialFingerprints`.

## Configuration

Optional `hookwarden.config.yaml` at any walked-up parent directory:

```yaml
schema_version: '1.0'
fail_on: high
parse_coverage_min: 0.9
baseline:
  enabled: true
  path: .hookwarden.baseline.json
```

CLI flags override the config file; the config overrides defaults.

## Provider coverage

v0.2 ships rules for **six providers**, each with provider-doc-quoted fix guidance on every finding:

| Provider | Detections | Custom signing |
|---|---|---|
| **Stripe** | 9 | — |
| **GitHub** | 9 | — |
| **Shopify** | 7 | — |
| **Slack** | 7 | — |
| **Twilio** | 7 | URL+sorted-params + HMAC-SHA1 |
| **Square** | 6 | — |

Coming next: Adyen, Zendesk, Mailgun, SendGrid — measured against a 200-repo OSS regression corpus with a published <5% false-positive rate.

See the full [rule coverage matrix](https://github.com/Hookwarden/hookwarden/blob/main/docs/rule-coverage.md).

## License

Apache 2.0. The CLI, engine, and rule packs are open source forever. A separate, closed-source SaaS tier handles continuous monitoring, leak scanning, secret rotation, and SOC 2 evidence export.

## Links

- [hookwarden.dev](https://hookwarden.dev)
- [GitHub repo](https://github.com/Hookwarden/hookwarden)
- [Issue tracker](https://github.com/Hookwarden/hookwarden/issues)
