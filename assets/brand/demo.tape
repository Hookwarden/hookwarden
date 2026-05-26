# vhs tape for hookwarden README demo
# Compact, brand-themed — Geist Mono on the locked palette
# (bg #0B0F14, text #E5E7EB, accent #6366F1, surface #1E293B).

Output demo.gif
Set FontFamily "Geist Mono"
Set FontSize 12
Set Width 1280
Set Height 580
Set Padding 14
Set Shell "bash"
Set TypingSpeed 25ms
Set LineHeight 1.35
Set BorderRadius 8

# Brand palette (matches packages/web tokens.css)
Set Theme { "name": "hookwarden", "black": "#0B0F14", "red": "#F43F5E", "green": "#10B981", "yellow": "#F59E0B", "blue": "#6366F1", "purple": "#A78BFA", "cyan": "#06B6D4", "white": "#E5E7EB", "brightBlack": "#1E293B", "brightRed": "#FB7185", "brightGreen": "#34D399", "brightYellow": "#FCD34D", "brightBlue": "#818CF8", "brightPurple": "#C4B5FD", "brightCyan": "#22D3EE", "brightWhite": "#F8FAFC", "background": "#0B0F14", "foreground": "#E5E7EB", "cursor": "#6366F1", "selection": "#1E293B" }

Hide
Type "export PS1='$ '" Enter
Type "cd demo-fixtures" Enter
Type "clear" Enter
Show

# ── Frame 1: clean scan ──────────────────────────────────────
Type "# 1. Clean scan — exits 0, parses 100%, zero findings"
Sleep 350ms
Enter
Type "./hookwarden scan clean/"
Sleep 250ms
Enter
Sleep 2500ms

# ── Frame 2: scan with a bug ─────────────────────────────────
Type "# 2. Scan with a bug — exits 1, finds it, prints the fix"
Sleep 350ms
Enter
Type "./hookwarden scan buggy/"
Sleep 250ms
Enter
Sleep 4500ms

# ── Frame 3: PHP scan — proves v0.4 third-language support ───
Type "# 3. PHP scan — Laravel === comparison flagged as timing-unsafe"
Sleep 350ms
Enter
Type "./hookwarden scan buggy-php/"
Sleep 250ms
Enter
Sleep 4500ms

# ── Frame 4: inventory — the three-state verdict ─────────────
Type "# 4. Inventory — every handler with its verdict: verified / manual-review / not-verified"
Sleep 350ms
Enter
Type "./hookwarden inventory mixed/"
Sleep 250ms
Enter
Sleep 5000ms

Sleep 1500ms
