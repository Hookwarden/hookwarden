#!/usr/bin/env bash
# record-demo.sh — regenerate assets/brand/scan-demo.gif from demo.tape.
#
# Builds the workspace, symlinks the CLI into demo-fixtures/, runs vhs,
# cleans up the symlink. Designed to be idempotent — running twice
# produces the same scan-demo.gif modulo timing jitter in vhs.
#
# Prerequisites:
#   - pnpm + node 22+ (matches CLAUDE.md tech stack)
#   - vhs (https://github.com/charmbracelet/vhs)
#
# Usage (from repo root):
#   ./assets/brand/record-demo.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRAND_DIR="$REPO_ROOT/assets/brand"
FIXTURES_DIR="$BRAND_DIR/demo-fixtures"
CLI_BIN="$REPO_ROOT/packages/cli/bin/cli.cjs"
HOOKWARDEN_SYMLINK="$FIXTURES_DIR/hookwarden"

if ! command -v vhs >/dev/null 2>&1; then
  echo "error: vhs not found — install from https://github.com/charmbracelet/vhs" >&2
  exit 1
fi

if [[ ! -d "$FIXTURES_DIR" ]]; then
  echo "error: demo-fixtures dir missing: $FIXTURES_DIR" >&2
  exit 1
fi

echo "==> Building CLI (pnpm build)…"
(cd "$REPO_ROOT" && pnpm build >/dev/null)

if [[ ! -f "$CLI_BIN" ]]; then
  echo "error: CLI entry not built: $CLI_BIN" >&2
  exit 1
fi

# Symlink hookwarden into demo-fixtures so the tape's `./hookwarden ...`
# commands resolve. Removed by the EXIT trap below.
ln -sf "$CLI_BIN" "$HOOKWARDEN_SYMLINK"
chmod +x "$CLI_BIN"
cleanup() { rm -f "$HOOKWARDEN_SYMLINK"; }
trap cleanup EXIT

echo "==> Recording scan-demo.gif via vhs…"
(cd "$BRAND_DIR" && vhs demo.tape)

echo "==> Done. Updated: $BRAND_DIR/scan-demo.gif"
