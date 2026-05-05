---
"hookwarden": patch
---

Fix npm-page banner: swap `raw.githubusercontent.com` → `cdn.jsdelivr.net` for the readme-banner SVG. GitHub's raw endpoint sets `Content-Security-Policy: ... sandbox` on SVG responses, which npmjs.com's iframe renderer refuses to load. jsDelivr serves the same file with permissive CORS and no sandbox header.

No code changes. Docs-only patch.
