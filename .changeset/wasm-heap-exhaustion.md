---
"@hookwarden/engine": patch
"hookwarden": patch
---

Very large repos no longer hang the scan when the tree-sitter parser runs out of memory.

Every clean Python/PHP/Go syntax tree is kept in one fixed-size WASM heap for the whole scan. On repos with roughly 10k+ such files the parser aborted and the scan spun until killed. Trees for files that failed to parse are now freed immediately, and a parser abort ends the scan with exit code 2 and a clear `parser ran out of memory` error suggesting a narrower scan root.
