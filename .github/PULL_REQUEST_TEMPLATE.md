<!-- Thanks for contributing! Keep PRs to one logical change. -->

## What & why

<!-- What does this change and why? Link any issue: Closes #N -->

## Type

- [ ] Bug fix
- [ ] New rule / provider / framework
- [ ] Feature
- [ ] Docs / chore

## Checklist

- [ ] `pnpm -r test` passes (incl. **negative tests** — input rejection / adversary-shaped inputs, not just happy path)
- [ ] `pnpm biome check` clean
- [ ] New rules ship **positive AND negative fixtures** and stay quiet on correct code
- [ ] Engine purity preserved (no `fs`/`net`/`process`/`node:*` in `packages/engine`)
- [ ] Added a `changeset` for user-facing changes to a published package
- [ ] No secrets, credentials, or `.planning/` content included
