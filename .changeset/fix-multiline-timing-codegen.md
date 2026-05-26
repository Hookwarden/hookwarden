---
"@hookwarden/rules": patch
"hookwarden": patch
---

`hookwarden fix` now applies the timing-unsafe-comparison fix on real multi-line handlers.

The JS/TS codegen searched for the insecure `==`/`===` comparison only on the finding's
own line — but findings are anchored to the handler declaration, while the comparison
usually sits several lines into the body. As a result `fix` reported the finding but
generated no edit ("0 fixable") for any normal handler; it only worked when the comparison
happened to be on the handler's first line. The codegen now searches the handler's full
line span and rewrites the sole `==`/`===` comparison it finds, declining only when the
span contains more than one (ambiguous — a safe fixer never guesses).
