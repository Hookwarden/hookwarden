---
"@hookwarden/engine": patch
"hookwarden": patch
---

Fix a false positive: `wrong-hmac-algorithm` no longer flags JS/TS handlers that correctly
use HMAC-SHA256. Node's `crypto.createHmac('sha256', …)` passes the algorithm as a string
literal (unlike Python's `hashlib.sha256`, a member-access symbol), so the engine never saw
it — and the rule treated every manual-HMAC JS handler as "algorithm undetermined", emitting
a spurious `manual-review`. The engine now captures the literal algorithm as a `crypto.<algo>`
reachable symbol, so SHA-256 is confirmed (no finding) while MD5/SHA-1 are still caught.
