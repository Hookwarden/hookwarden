---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
---

feat(engine, rules): add provider_docs_url + path_severity_overrides to RuleDefinition

D-57 RULES-05: per-rule path_severity_overrides (post-emit severity rewrite, no state change).
D-58 RULES-08: provider_docs_url required field on every rule.
Engine ships pure-functional applyPathSeverityOverrides helper; rules schema bumps Ajv strict shape.
Smoke-rule github/missing-timing-safe-equal.yaml updated to satisfy new required field.
