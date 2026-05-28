# Bugs in the wild — methodology

The **Found in the wild** table in the README is regenerated weekly by
[.github/workflows/wild-scan.yml](./.github/workflows/wild-scan.yml)
running
[.github/scripts/wild-scan.ts](./.github/scripts/wild-scan.ts)
against a fixed corpus of public OSS projects with webhook handlers.

This document is the public-facing audit trail: the *what*, the *how*,
and the *why* of those numbers.

## What we publish

In the README table:

- **Date** of the most recent scan
- **Number of targets** scanned
- **Aggregate severity counts** across the entire corpus
- **Count of targets** with zero critical/high findings
- A link to this document and to the [target list](./.github/scripts/wild-targets.txt)

## What we do NOT publish

Without coordinated disclosure, we never publish:

- **Per-target finding counts** — saying "we found N critical bugs in
  &lt;Project&gt;" before the project has had a chance to triage is the
  textbook way to give attackers a 24-hour head-start over maintainers.
- **File paths, line numbers, or snippets** of unfixed findings
- **Rule IDs that fired against a specific target** — even rule IDs
  can give attackers enough context to find the bug themselves

Once a finding is confirmed and fixed (PR merged, advisory closed, or
project-acknowledged > 90 days), we may link to the merged PR in this
document — never before.

## Disclosure window

We follow a **90-day coordinated disclosure** policy:

1. We file a private report via the project's `SECURITY.md` contact,
   or via GitHub Security Advisories if the repo supports them.
2. We give the maintainers up to 90 days to triage and release a fix.
3. After the fix ships, OR after 90 days with no response and no
   discussion, we may publish a write-up.
4. We never publish proof-of-concept exploit code.

## How targets are chosen

Selection criteria (codified at the top of
[wild-targets.txt](./.github/scripts/wild-targets.txt)):

- ≥5,000 GitHub stars (credible / production user base)
- Recent activity (push within last 6 months)
- Public Apache, MIT, or AGPL license
- TypeScript, Python, or PHP source (the three languages hookwarden
  scans)
- Contains webhook handlers (Stripe, GitHub, Shopify, Twilio, Slack,
  or Square — the six providers hookwarden ships rules for)

The list is small (currently 8 projects) and stable — drift in the
numbers reflects code changes, not corpus changes. Adding or removing
a target requires a normal PR against `wild-targets.txt`; the next
weekly run picks it up.

## The exact scan command

Reproducible locally:

```bash
git clone --depth 1 https://github.com/<org>/<repo> /tmp/target
npx hookwarden scan /tmp/target --format json
```

The workflow uses the same command. The only difference: CI pins
`HW_VERSION=latest` so post-publish breakage is caught immediately.

## Why aggregate-only is the right tradeoff

A live README table proves three things at once:

1. **The product is alive.** A weekly date stamp is harder to fake
   than a static "we found bugs once" claim.
2. **The product works on real code.** Aggregate severity counts
   anchor the marketing copy in observable numbers, not vibes.
3. **The product is run ethically.** The corpus is public, the
   methodology is public, and the per-target findings are not
   weaponized.

If you want to know what hookwarden would say about *your* code:

```bash
npx hookwarden scan ./your-app
```

It runs locally. No network. No telemetry. We never see your code.

## If you maintain a project in the corpus

Two paths:

- **Want off the list?** Open a PR removing your repo from
  `wild-targets.txt`. We'll merge it the same day, no questions
  asked.
- **Want to know what we found?** Email security@hookwarden.dev with
  proof you maintain the repo (commit access, an entry in
  CODEOWNERS, or a GitHub Security Advisory invite) and we'll share
  the per-target findings privately.
