"""Placeholder entry point. The hookwarden CLI ships on npm; install via `npx hookwarden@latest scan`."""
import sys


def main() -> int:
    sys.stderr.write(
        "hookwarden: this PyPI package is a placeholder.\n"
        "Install the CLI via npm: npx hookwarden@latest scan\n"
        "See https://hookwarden.dev\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
