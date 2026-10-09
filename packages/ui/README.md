# @hookwarden/ui

The local web UI and single-file HTML report behind [`hookwarden ui`](https://github.com/Hookwarden/hookwarden#local-ui--html-report) and `hookwarden scan --format html`. You normally don't install this directly — the `hookwarden` CLI depends on it.

- `startUiServer({ root, handlers })` — serves the app on `127.0.0.1` with a per-launch bearer token, a Host-header check, a script-hash CSP, and fix targets confined to `root`. The scan and fix work is done by the handlers the CLI passes in.
- `renderReport(scanJson)` — the same app with a scan embedded; read-only and `connect-src 'none'`.

The app (Preact) is built at install/pack time into one HTML string (`src/generated/app-html.ts`), so the standalone `bun --compile` binaries serve it without a filesystem.

Apache-2.0.
