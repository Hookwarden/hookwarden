# vhs tape for hookwarden README demo
# Renders `hookwarden scan` against a known-buggy + known-clean fixture
# pair from the release-smoke corpus. Three distinct frames so the loop
# tells a story: clean → bug → JSON envelope.

Output demo.gif
Set FontSize 15
Set Width 1100
Set Height 720
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 30ms
Set Shell "bash"

Hide
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

# ── Frame 1: clean scan ──────────────────────────────────────────────────
Type "# 1. Clean scan — exits 0, parses 100%, zero findings:"
Sleep 500ms
Enter
Type "./hookwarden scan clean/"
Sleep 300ms
Enter
Sleep 3000ms

# ── Frame 2: scan with a bug ─────────────────────────────────────────────
Type "# 2. Scan with a bug — exits 1, finds it, prints the fix:"
Sleep 500ms
Enter
Type "./hookwarden scan buggy/"
Sleep 300ms
Enter
Sleep 5000ms

# ── Frame 3: JSON envelope (CI-friendly) ─────────────────────────────────
Type "# 3. JSON envelope shape — CI parses this:"
Sleep 500ms
Enter
Type "./hookwarden scan buggy/ --format json | jq '.scan.counts.active'"
Sleep 300ms
Enter
Sleep 4000ms

Sleep 1500ms
