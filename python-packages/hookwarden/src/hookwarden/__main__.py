"""hookwarden — Python shim entry point.

Pipeline: detect_target → resolve pinned SHA → cache lookup (under filelock)
→ on miss download_and_verify → execv the binary so the user sees its exit
code directly. Exit code 2 on integrity / config / unsupported-target
errors (Phase 4 D-65 exit-code matrix).
"""
from __future__ import annotations

import sys

from . import __version__, _binary, _cache, _exec, _fetch


def main() -> int:
    try:
        target = _binary.detect_target()
        expected_sha = _binary.pinned_sha(target)
        binary_url = _binary.release_url(target, __version__)
        cache_dir = _cache.cache_dir_for(target)
        binary_path = cache_dir / _binary.exec_name(target)

        with _cache.lock(cache_dir):
            if not _cache.is_valid(binary_path, expected_sha):
                _fetch.download_and_verify(binary_url, expected_sha, binary_path)

        return _exec.exec_binary(binary_path, sys.argv[1:])
    except _fetch.IntegrityError as e:
        sys.stderr.write(f"{e}\n")
        return 2
    except KeyError as e:
        sys.stderr.write(
            f"hookwarden: no binary pinned for this target ({e}). "
            f"This installation may be from an unstamped wheel; please reinstall.\n"
        )
        return 2
    except RuntimeError as e:
        sys.stderr.write(f"{e}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
