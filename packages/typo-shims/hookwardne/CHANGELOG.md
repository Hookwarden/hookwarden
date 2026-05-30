# hookwardne

## 0.7.0

### Patch Changes

- Updated dependencies
  - hookwarden@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [c81cc40]
  - hookwarden@0.6.0

## 0.5.5

### Patch Changes

- Updated dependencies [80c46ef]
- Updated dependencies [3217cec]
  - hookwarden@0.5.5

## 0.5.4

### Patch Changes

- Updated dependencies
  - hookwarden@0.5.4

## 0.5.3

### Patch Changes

- Updated dependencies
- Updated dependencies [a2e1946]
  - hookwarden@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [4a2201b]
- Updated dependencies [992b3d2]
  - hookwarden@0.5.2

## 0.5.1

### Patch Changes

- 525ad50: Emergency patch — v0.5.1.

  v0.5.0 shipped `hookwarden` declaring a dependency on `@hookwarden/fix@0.0.1`
  but the `@hookwarden/fix` package was never published to npm. Every fresh
  `npx hookwarden scan .` since v0.5.0 has failed with HTTP 404 on
  `https://registry.npmjs.org/@hookwarden%2ffix`.

  Root cause: `@hookwarden/fix` was not in the changesets `fixed` group, so
  when v0.5.0's changeset bumped the CLI + engine + rules together, it
  silently skipped publishing `@hookwarden/fix`. The package was correctly
  configured for publish (`publishConfig: { access: 'public' }`, not
  `private`, built into `dist/`) — the publish pipeline just never targeted
  it.

  This patch:

  - Adds `@hookwarden/fix` to the `fixed` group in `.changeset/config.json`,
    so future bumps keep it in lockstep with the other publishable workspace
    packages. Prevents recurrence.
  - Bumps every package in the fixed group to v0.5.1 so the CLI's pinned
    `@hookwarden/fix` dep resolves against a version that's actually on the
    registry.

  No behavior changes vs. v0.5.0 — pure release-pipeline hygiene.

- Updated dependencies [525ad50]
  - hookwarden@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [66814fc]
  - hookwarden@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [13b7438]
- Updated dependencies
  - hookwarden@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [2496be2]
  - hookwarden@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [f72331f]
- Updated dependencies [08fb590]
- Updated dependencies [442f0b9]
  - hookwarden@0.3.0

## 0.2.0

### Patch Changes

- hookwarden@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [0a0ff4c]
- Updated dependencies [1fadc62]
  - hookwarden@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [89746ba]
- Updated dependencies [43379cb]
- Updated dependencies [c7b39d1]
  - hookwarden@0.1.0

## 0.0.1

### Patch Changes

- 7ffb431: Initial v0.0.1 release — defensive name registrations.

  Empty stubs for all 9 OSS package names (1 canonical + 4 scoped + 5 typo
  shims) to claim namespaces on npm before any public mention. Functional
  implementations land in subsequent versions.

- Updated dependencies [7ffb431]
  - hookwarden@0.0.1
