"""Entry point for the hookwardn typo-defense console script."""
import sys


def main() -> int:
    sys.stderr.write(
        "[hookwarden] Note: you ran `hookwardn`. The canonical package is `hookwarden` on npm.\n"
        "Install via: npx hookwarden@latest scan\n"
        "See https://hookwarden.dev\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
