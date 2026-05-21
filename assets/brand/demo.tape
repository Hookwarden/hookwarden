# vhs tape for hookwarden README demo
# Renders `hookwarden scan` against a known-buggy + known-clean fixture
# pair from the release-smoke corpus. Output: demo.gif (committed to
# `assets/brand/demo.gif` in the Hookwarden/hookwarden repo).

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

# Frame 1 — clean scan
Type "# Clean scan — exits 0:"
Sleep 400ms
Enter
Type "./hookwarden scan fixtures/stripe-verified.ts"
Sleep 300ms
Enter
Sleep 2500ms

# Frame 2 — scan with a bug
Type "# Scan with a bug — exits 1, finds the bug, prints the fix:"
Sleep 400ms
Enter
Type "./hookwarden scan fixtures/stripe-not-verified.ts"
Sleep 300ms
Enter
Sleep 4500ms

# Frame 3 — JSON envelope
Type "# JSON envelope shape (CI-friendly):"
Sleep 400ms
Enter
Type "./hookwarden scan fixtures/stripe-not-verified.ts --format json | jq '.scan.counts'"
Sleep 300ms
Enter
Sleep 3500ms

Sleep 2s
