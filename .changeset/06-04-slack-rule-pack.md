---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
---

feat(rules): Slack rule pack — first non-null timestamp_header (RULES-01)

Catalog gains `slack` entry with hmac_algorithm: 'sha256', signing_input_format:
'timestamp_dot_body', signature_header: ['x-slack-signature'], signature_encoding: 'hex',
timestamp_header: 'x-slack-request-timestamp'. Slack is the FIRST provider in the v1 catalog
where timestamp_header is non-null — the parameterized missing-timestamp-check factory's
non-null branch is exercised end-to-end (5-minute tolerance window per Slack docs;
slack/missing-timestamp-check ships at severity: high, NOT info).

Slack's canonical-string `'v0:' + ts + ':' + body` IS representable by the parameterized
`timestamp_dot_body` recipe — no custom predicate needed. Pure additive use of 06.1's locked
factories.

7 rule YAMLs ship: missing-signature-verification, timing-unsafe-comparison, raw-body-misuse,
missing-timestamp-check (high), wrong-hmac-algorithm, unreachable-verification, library-
verified. hardcoded-secret-prefix excluded per D-95 (Slack signing secrets have no canonical
prefix; xoxb-/xoxp- API tokens are different and live in Phase 11 leak-scanner scope).

ALL_PREDICATES grows from 28 → 35 keys (7 new slack-* entries).
docs/rule-coverage.md gains the slack row.

11 JS + 3 Python synthetic fixtures under test/fixtures/slack/. test/slack.test.ts adds
~17 it() assertions including explicit Date.now-reachable / not-reachable cases for the
non-null timestamp_header branch.

findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New slack/* rules. Corpus repos containing Slack webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, unreachable-verif, AND missing-timestamp-check (the latter at severity: high — Slack signing requires the 5-minute tolerance per their docs). The 7-rule additive count matches applicable_rules length in PROVIDER_CATALOG.slack.'
