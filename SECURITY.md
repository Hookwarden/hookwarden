# Security Policy

hookwarden is a security tool, so we hold our own code to the bar we hold yours to.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's [private vulnerability reporting](https://github.com/Hookwarden/hookwarden/security/advisories/new) (Security → Advisories → *Report a vulnerability*). We aim to:

- **Acknowledge** your report within **3 business days**.
- Provide an initial **assessment and severity** within **7 business days**.
- Ship a fix and publish an advisory (crediting you, if you wish) once a patch is available.

If you can't use GitHub advisories, you can request a secure channel by opening a minimal issue that contains **no details** beyond "I'd like to report a security issue privately."

## Scope

In scope:

- The CLI and engine (`hookwarden`, `@hookwarden/engine`, `@hookwarden/rules`, `@hookwarden/fix`) — e.g. a crafted input file that causes code execution, path traversal outside the scan root, or a crash/DoS in the parser.
- **False negatives that defeat the tool's purpose** — a webhook-verification bug pattern hookwarden *should* flag `not-verified` but reports as `verified`. We treat a missed bug as a security issue, not just a quality one.

Out of scope:

- False positives (please open a normal issue).
- Findings in *your* code that hookwarden correctly reports — that's the tool working.

## Supported versions

Only the latest published `0.x` minor receives security fixes while the project is pre-1.0. Always run the latest: `npx hookwarden@latest`.
