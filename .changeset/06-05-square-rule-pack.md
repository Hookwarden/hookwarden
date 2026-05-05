---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
---

feat(rules): Square rule pack — first custom_field_tuple recipe (RULES-01)

Catalog gains `square` entry with hmac_algorithm: 'sha256', signing_input_format:
'custom_field_tuple' (URL+body), signature_header: ['x-square-hmacsha256-signature'],
signature_encoding: 'base64', timestamp_header: null. After 06.5, four of five
signing_input_format recipes are exercised end-to-end (raw_body, timestamp_dot_body,
custom, custom_field_tuple); only url_plus_sorted_params remains documentation-only.

6 rule YAMLs ship for Square: missing-signature-verification, timing-unsafe-comparison,
raw-body-misuse, wrong-hmac-algorithm, unreachable-verification, library-verified.
- missing-timestamp-check intentionally NOT shipped (Square's signing scheme has no
  timestamp header; replay protection is the application's responsibility — analogous
  to Twilio).
- hardcoded-secret-prefix intentionally NOT shipped per D-95 verification: Square's
  webhook subscription `signature_key` is a random base64 string with no canonical
  literal prefix. Square's API ACCESS tokens (EAAA..., sq0csp-..., sandbox-sq0atb-...)
  do have prefixes but those are different artifacts handled by GitGuardian/TruffleHog
  (PROJECT.md scope). This DEVIATES from the plan's must_haves first bullet, which
  assumed Square has a canonical prefix; the action-step-2 verification carved the
  honest decision (documented in research/square.md).

ALL_PREDICATES grows from 35 → 41 keys (6 new square-* entries; no
square-missing-timestamp-check key registered since the rule does not ship).
docs/rule-coverage.md gains the square row.

11 JS + 3 Python synthetic fixtures under test/fixtures/square/. test/square.test.ts
adds 14 it() assertions.

findings_delta:
  added: 6
  removed: 0
  severity_changes: []
  rationale: 'New square/* rules. Corpus repos containing Square webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The 6-rule additive count matches applicable_rules length in PROVIDER_CATALOG.square. Net Phase 6 delta: 7 (Shopify) + 7 (Twilio) + 7 (Slack) + 6 (Square) + 0 (06.1 refactor) = 27 new rules.'
