# vhs tape for hookwarden README demo
# Compact, brand-themed — Geist Mono on the locked palette
# (bg #0B0F14, text #E5E7EB, accent #6366F1, surface #1E293B).

Output scan-demo.gif
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

# ── Frame 1: inventory — polyglot + three-state verdict ──────
Type "# 1. Every handler, every language — JS · Python · PHP — with its verdict"
Sleep 350ms
Enter
Type "./hookwarden inventory mixed/"
Sleep 250ms
Enter
Sleep 5000ms
Hide
Type "clear" Enter
Show

# ── Frame 2: verified — recognizes correct code (no false alarm) ──
Type "# 2. Correct verification is recognized as [verified] — not a false alarm"
Sleep 350ms
Enter
Type "./hookwarden scan mixed/stripe.js"
Sleep 250ms
Enter
Sleep 4000ms
Hide
Type "clear" Enter
Show

# ── Frame 3: fix — mechanical, constant-time rewrite ─────────
Type "# 3. Fix it — insecure === rewritten to a constant-time comparison"
Sleep 350ms
Enter
Type "./hookwarden fix mixed/ --only github/timing-unsafe-comparison"
Sleep 250ms
Enter
Sleep 5000ms
Hide
Type "clear" Enter
Show

# ── Frame 4: CI — SARIF output + non-zero exit ───────────────
Type "# 4. CI-ready: SARIF 2.1.0 output, non-zero exit gates the build"
Sleep 350ms
Enter
Type './hookwarden scan mixed/ --format sarif > report.sarif; echo "exit $? — report.sarif ready for code scanning"'
Sleep 250ms
Enter
Sleep 4000ms

Sleep 1500ms
