---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
---

feat(engine, rules): Twilio rule pack (RULES-01) + custom-predicate slot first use (D-92)

Catalog gains `twilio` entry with hmac_algorithm: 'sha1', signing_input_format: 'custom',
signature_encoding: 'base64', timestamp_header: null. The 'sha1' value extends the engine's
hmac_algorithm union from `'sha256' | 'sha512'` to `'sha1' | 'sha256' | 'sha512'` — Twilio
is the v1 outlier and the only sha1 provider. The union remains intentionally narrow (no
md5, no sha224/sha384) so wrong-hmac-algorithm.ts derives WRONG_HINTS from a closed set.

First real use of the D-92 custom-predicate slot:
`packages/rules/src/predicates/custom/twilio-signing.ts` implements the entry-point
verification check. The catalog entry sets `signing_input_format: 'custom'` and the
missing-signature-verification factory dispatches via `CUSTOM_SIGNING_PREDICATES['twilio']`.
Side-effect registration via static top-level import (no dynamic import; engine purity
preserved per D-23). The factory's wrong-hmac-algorithm.ts already handles 'sha1' via its
`ALL_ALGO_HINTS.filter` derivation — no additional branching code needed.

7 rule YAMLs ship for Twilio: missing-signature-verification, timing-unsafe-comparison,
raw-body-misuse, missing-timestamp-check (info), wrong-hmac-algorithm (high; sha1 expected),
unreachable-verification, library-verified. hardcoded-secret-prefix excluded per D-95.

ALL_PREDICATES grows from 21 → 28 keys (7 new twilio-* entries).
docs/rule-coverage.md gains the twilio row noting the custom-predicate path.

findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New twilio/* rules + sha1 hmac_algorithm union extension. Corpus repos containing twilio webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The sha1 union extension is a discrete, reviewed type change — downstream callers that exhaustively switch on hmac_algorithm will surface a compile-time error (desired failure mode).'
