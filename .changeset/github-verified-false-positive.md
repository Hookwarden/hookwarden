---
"@hookwarden/rules": patch
"hookwarden": patch
---

Fix a false-positive `critical` on correctly-verified GitHub webhook handlers. The
`github-timing-safe-equal` predicate (backing `github/missing-timing-safe-equal` and
`github/timing-unsafe-comparison`) returned `"verified"` on the safe path; because the engine
builds a finding for any non-null verdict and stamps it with the rule's fixed `critical` severity
and "verification missing" message, a textbook-correct hand-rolled handler
(`crypto.createHmac` + `crypto.timingSafeEqual`, exactly per GitHub's docs) surfaced two
false-positive criticals and failed the build. The safe path now returns `null` (no finding) —
the positive signal remains the job of the info-severity `github/library-verified` rule, matching
the convention every other provider's critical rules already follow.

Also makes `--fail-on` gating state-aware so exit codes match the documented summary legend:
`verified` findings never gate (a correctly-verified handler is not a build failure),
`manual-review` findings gate only at `--fail-on low`/`info` (not the default `high`), and
`not-verified` findings continue to gate by severity.
