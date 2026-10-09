---
"hookwarden": minor
"@hookwarden/ui": minor
---

Add a local web UI and an HTML report, so hookwarden is usable without the terminal.

- `hookwarden ui [path]` opens the findings in your browser: filter by severity, provider or text, read the redacted code and references, preview each automatic fix as a diff, and apply the safe ones (same atomic staging as `hookwarden fix --write`, then a re-scan). The server binds `127.0.0.1` only, requires the per-launch token in the printed URL, rejects foreign `Host` headers, and only writes inside the folder you pass. `--port N`, `--no-open`.
- `hookwarden scan --format html > report.html` writes one self-contained, offline, read-only report to attach to a PR or email.
