---
"hookwarden": patch
---

Release pipeline: `bump-homebrew.sh` updated to handle the Linux-only formula shape introduced in v0.3.0 (deferred macOS binaries; see [Hookwarden/homebrew-tap#1](https://github.com/Hookwarden/homebrew-tap/pull/1)).

Two changes coupled to the new formula shape:

- Drop `SHA_DARWIN_ARM` / `SHA_DARWIN_X64` extraction (mirrors `stamp-checksums.py`'s `REQUIRED_TARGETS` pattern: explicit Linux-only list, fail-fast on missing pins).
- Replace `sed -i.bak ... version "X.Y.Z"` with `sed -i.bak ... releases/download/vX.Y.Z` — the new formula has no explicit `version` line (auto-derived from the top-level URL to satisfy `brew audit --strict` style ordering). Version updates ride the URL substring.

No user-facing CLI changes — internal release-tooling fix. Closes the v0.3.0 onion-peel bug 7 from [#12](https://github.com/Hookwarden/hookwarden/issues/12). Bugs 1–6 (negative-test coverage) will follow in a separate PR.
