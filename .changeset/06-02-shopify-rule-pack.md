---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
---

feat(rules): Shopify rule pack (RULES-01)

Catalog gains `shopify` entry with hmac_algorithm: 'sha256', signing_input_format: 'raw_body',
signature_header: ['x-shopify-hmac-sha256'], signature_encoding: 'base64', timestamp_header: null.
No new TS predicate code — pure additive use of the 06.1 catalog-parameterized factories.

7 rule YAMLs ship for Shopify: missing-signature-verification, timing-unsafe-comparison,
raw-body-misuse, missing-timestamp-check (info), wrong-hmac-algorithm, unreachable-
verification, library-verified. hardcoded-secret-prefix is intentionally excluded per D-95
(Shopify webhook secrets have no canonical prefix; `secret_literal_prefix: []` in catalog).
11 synthetic JS fixtures + 3 Python fixtures cover all detection patterns + positive/negative
cases per D-97.

Bootstraps `docs/rule-coverage.md` with the per-provider applicability matrix (stripe + github
+ shopify rows; subsequent provider plans append rows).

ALL_PREDICATES grows from 14 → 21 keys (7 new shopify-* entries).

findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New shopify/* rules. Corpus repos containing Shopify webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The 7-rule additive count matches applicable_rules length in PROVIDER_CATALOG.shopify. Verifiable via predicate vitest suite (test/shopify.test.ts) on synthetic fixtures.'
