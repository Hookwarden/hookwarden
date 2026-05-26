# Contributing to hookwarden

Thanks for helping make webhook verification safer. The CLI, engine, and rules are Apache-2.0 and contributions are welcome.

## Ground rules

- **Be excellent to each other** — see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- **Security issues go private** — see [SECURITY.md](./SECURITY.md), not a PR.
- By contributing, you agree your work is licensed under Apache-2.0.

## Project layout

Monorepo (pnpm workspaces, Node 22+, TypeScript strict):

- `packages/engine` — pure analysis core (parsing, reachability, evidence). **No fs/network/process at runtime.**
- `packages/rules` — provider catalog + detection predicates + fix codegen.
- `packages/cli` — the `hookwarden` command (scan / inventory / explain / fix).
- `packages/fix` — language rewriters used by `hookwarden fix`.

## Dev setup

```bash
pnpm install        # Node 22+, pnpm
pnpm build          # tsc --build across the workspace
pnpm -r test        # vitest across all packages
pnpm biome check    # lint + format
```

## The bar for a good PR

- **Tests required**, including negative tests (input rejection, adversary-shaped inputs, boundary cases) — not just the happy path. Our false-positive rate is the product; new rules must demonstrate they stay quiet on correct code.
- **Keep the engine pure.** No `fs`/`net`/`process`/`node:*` imports in `packages/engine` — `dependency-cruiser` enforces this.
- **New rules:** add positive *and* negative fixtures under `packages/rules/test/fixtures/<provider>/`, and a per-rule entry. A rule that flags correct code is a regression.
- Run `pnpm biome check --write` before pushing; a pre-push hook runs the suite.
- One logical change per PR. Add a [changeset](https://github.com/changesets/changesets) (`pnpm changeset`) for any user-facing change to a published package.

## Adding a provider or framework

Open an issue first describing the provider's signature scheme (algorithm, header, timestamp/replay model). The catalog encodes these quirks centrally — see existing entries in `packages/rules`.
