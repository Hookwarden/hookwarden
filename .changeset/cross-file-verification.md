---
"@hookwarden/engine": patch
"@hookwarden/rules": patch
"hookwarden": patch
"@hookwarden/mcp": patch
---

Follow webhook verification across files. Reachability now resolves `../../`-style relative imports against the importing file (exact path first, so a same-named file elsewhere in the tree is never picked), looks up aliased imports in the file that declared them (not the handler), and walks 4 hops by default (was 3). Handlers that verify through a helper → shared util (the n8n trigger shape) no longer get false `missing-timing-safe-equal` / `missing-timestamp-check` findings. `raw-body-misuse` now reports `manual-review` instead of `not-verified` when verification is only reachable through a helper, since the raw-body read lives in code the heuristic can't see. Provider attribution no longer treats a bare verify name imported from an unrelated package (e.g. graphql's `validate`) as that provider's SDK verification — the deeper walk had started surfacing those. `--verify-secrets` copy no longer points at a dashboard that isn't live yet.
