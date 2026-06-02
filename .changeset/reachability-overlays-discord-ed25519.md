---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
"hookwarden": minor
---

Add queue-handler + edge-runtime reachability overlays and the first asymmetric (Ed25519) provider.

- **REACH-01 — queue-handler reachability**: a handler that enqueues the raw body via bullmq / SQS / inngest / Kafka and has a verifying consumer of that queue reachable now resolves to `manual-review` instead of `not-verified` (the engine can't prove same-payload verification across the queue boundary, so it never claims `verified`). A queue enqueue with no verifying consumer stays `not-verified`.
- **REACH-02 — edge-runtime detection**: webhook handlers on Cloudflare Workers (`export default { fetch }`), Vercel Edge (`runtime: 'edge'`), and Deno (`Deno.serve`) are now detected (Next.js App Router was already covered), so the HMAC-over-raw-body rules evaluate them instead of missing or mis-flagging. The full rule pack's `applies_to` now includes `cloudflare-workers` / `vercel-edge` / `deno`.
- **DISCORD-01 — Ed25519 provider**: Discord interactions are the first asymmetric provider (`signature_scheme: ed25519`, verified against the app public key). The rule recognizes `verifyKey` (discord-interactions-js), `nacl.sign.detached.verify` (tweetnacl), `nacl.signing.VerifyKey(...).verify(...)` (PyNaCl), and `sodium_crypto_sign_verify_detached` (PHP) as verified; a Discord handler with no Ed25519 verification is `not-verified`. Discord interaction paths are now detected.

Engine purity preserved; existing HMAC providers untouched.
