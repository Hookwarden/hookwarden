# hookwarden rule coverage matrix

Per-provider applicability matrix per Phase 6 D-94. Each cell indicates whether the listed
detection rule ships in the current rule pack. Rules NOT listed are intentionally omitted
per D-95 (no canonical secret prefix for hardcoded-secret-prefix) or per the per-provider
research note (no Python SDK; framework-specific FP risk; etc.).

| Provider | missing-sig-verif | timing-unsafe | raw-body | missing-timestamp | wrong-hmac | unreachable-verif | hardcoded-secret-prefix | library-verified | Custom predicate? |
|---|---|---|---|---|---|---|---|---|---|
| stripe | YES | YES | YES | YES | YES | YES | YES (`whsec_`) | YES | No |
| github | YES | YES | YES | YES | YES | YES | YES (`ghs_`, `github_pat_`) | YES | No |
| shopify | YES | YES | YES | YES (info) | YES | YES | NO (D-95 — no canonical prefix) | YES | No |
