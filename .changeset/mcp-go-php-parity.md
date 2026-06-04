---
"@hookwarden/mcp": minor
---

scan_handler now supports Go and PHP, giving the MCP full language parity with the CLI (js/ts/python/php/go). Bundles the tree-sitter-go and tree-sitter-php grammars, lazy-loads each dialect's WASM runtime per request, and removes the stale "PHP not in preview — use the CLI" rejection. AI coding agents can now scan Go and PHP webhook handlers directly through the MCP.
