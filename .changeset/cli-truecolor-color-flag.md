---
"hookwarden": patch
---

Terminal output overhaul — clearer and more colorful:

- **Truecolor palette.** CLI output now uses 24-bit truecolor from the brand palette (critical/not-verified `#F43F5E`, verified `#10B981`, medium/manual-review `#F59E0B`, high `#F97316`, info `#3B82F6`, `fix ›`/`docs ›` accent `#6366F1`, secondary `#64748B`) instead of the muted 16-color ANSI table.
- **`--color always|never|auto`** flag (also honors `FORCE_COLOR`) to force or disable color independent of TTY detection.
- **`--verbose` now shows its work** — lists every webhook handler found (provider · framework · verdict · file:line) before the findings, and appends `engine`/`rules` versions to the footer.
- **Leaner default footer:** sub-second scans show `Scanned in 38 ms` (was a confusing `0.0 s`); engine/rule-pack versions moved to `--verbose`; a clean scan no longer prints an all-zeros severity tally.
- **`info` gets a distinct `i` glyph** so it no longer collides with `low`'s `·`.
- **Consistent fix lines:** framework-scoped fix paragraphs (`Fix (Express):`) are now extracted into a `fix ›` line instead of being buried in the explanation prose.

Output format and JSON/SARIF envelopes are unchanged.
