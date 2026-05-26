---
"hookwarden": patch
---

CLI output is now vivid 24-bit **truecolor** drawn from the brand palette (critical/not-verified `#F43F5E`, verified `#10B981`, medium/manual-review `#F59E0B`, high `#F97316`, info `#3B82F6`, `fix ›`/`docs ›` accent `#6366F1`, secondary `#64748B`), replacing the muted 16-color ANSI table.

New `--color always|never|auto` flag (also honors `FORCE_COLOR`) so color can be forced through a pipe or recorder, or disabled, independent of TTY auto-detection. Output format is unchanged.
