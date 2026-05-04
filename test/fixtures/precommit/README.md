# Pre-commit fixture (DIST-01 smoke test)

Used by `.github/workflows/ci.yml` job `dist-01-precommit-fixture`. The fixture contains:

- `stripe-not-verified.ts` — a deliberately broken Stripe handler (express.json before webhook).
  Phase 3 RULES-03 reports this as not-verified at critical severity.
- `.pre-commit-config.yaml` — pre-commit configuration; the CI job substitutes `REPO_ROOT_PLACEHOLDER`
  with the absolute path of the checkout so pre-commit treats it as a real git repo.

The CI job asserts:

1. `pre-commit run --all-files` exits non-zero (because the Stripe handler is not-verified).
2. The output contains the fixture filename (proves the hook ran against the right file).
3. pre-commit successfully installs the hookwarden shim via `additional_dependencies: ['hookwarden']`
   (proves Step F's B4 fix works against a CONSUMER repo, not just the hookwarden repo itself).
