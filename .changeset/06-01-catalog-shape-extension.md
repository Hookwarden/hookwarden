---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
---

feat(engine, rules): catalog-parameterized predicate architecture (D-90, D-91, D-93)

ProviderCatalogEntry gains 5 additive readonly fields per D-91:
hmac_algorithm, signing_input_format, timestamp_header, signature_encoding,
applicable_rules. Existing fields unchanged — additive-only, no breaking change
for callers reading provider_catalog[provider].signature_header etc.

12 duplicated Stripe + GitHub provider-bound predicates collapse onto 6 catalog-
parameterized factory predicates: missing-signature-verification, timing-unsafe-
comparison, raw-body-misuse, missing-timestamp-check, wrong-hmac-algorithm,
unreachable-verification. Existing 14 registered predicate keys preserve byte-
identical names; existing Stripe + GitHub vitest suites stay green (regression net).

Custom-predicate slot scaffolded at packages/rules/src/predicates/custom/ —
actual provider-specific custom predicates (Twilio URL+sorted-params canonical-
string, etc.) land in subsequent provider plans via a CUSTOM_SIGNING_PREDICATES
registry that the missing-signature-verification factory dispatches to when
catalog.signing_input_format === 'custom'.

RULES_PACK_VERSION now sourced from package.json at module load (no drift).
Closes drift bug between packages/rules/src/index.ts ("0.0.1") and
packages/rules/package.json ("0.1.1").

findings_delta:
  added: 0
  removed: 0
  severity_changes: []
  rationale: 'Refactor-only change. No new rule YAMLs ship; the 14 registered predicate keys preserve byte-identical names and behavior on existing Stripe + GitHub fixtures. The findings_delta:0 claim is verifiable by running the predicate vitest suite (107 → 135 passing tests; 28 new direct factory tests added, zero existing assertions modified) plus the e2e CLI integration suite (354 passing on the canonical happy + bug fixtures).'
