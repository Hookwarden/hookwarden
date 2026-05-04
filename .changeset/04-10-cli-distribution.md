---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
"hookwarden": minor
---

Phase 4 — CLI distribution surface.

The CLI is now usable in any CI environment:

- `--format json` emits a versioned, sorted-keys JSON envelope (CLI-02; D-59)
- `--format sarif` emits SARIF 2.1.0 conformant against the OASIS schema and uploads cleanly to GitHub Code Scanning (CLI-03 + CLI-11; D-60 + D-76)
- Exit codes 0/1/2/3/4 with documented precedence 3 > 2 > 4 > 1 > 0 (CLI-04; D-65)
- `--fail-on` severity threshold; suppressed findings never count (CLI-05; D-66)
- Inline `// hookwarden-disable-next-line <rule-id>` comments (CLI-06; D-61)
- `.hookwardenignore` (gitignore syntax) for path-level suppression (CLI-07; D-62)
- `--diff-only` for CI acceleration (CLI-08; D-72 + D-74)
- `--baseline write` / auto-read for non-greenfield adoption (CLI-10; D-68 + D-69 + D-70)
- Bundle-inspection gate now runs on every release tag (CLI-09)
- `hookwarden.config.yaml` config file with the full schema (D-75)

Engine schema additive: `ScanMetadata` gains `parse_candidates_count` (D-64). `Finding` gains `suppressed` payload (D-63). Both additive — no breaking changes.

Standalone binaries via `bun build --compile` (macOS arm64/x64, Linux x64/arm64, Windows x64) are deferred to Phase 4.x (D-73). Trigger to revisit: a measurable repeat-install metric on `npx hookwarden`, or a paying customer requesting an air-gapped install path.
