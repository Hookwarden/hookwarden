#!/bin/bash
# Wrapper: build the Docker image (if missing) and run the smoke against
# the local fixture corpus. Override the version with HW_VERSION=latest
# to test the head of npm instead of the pinned default.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
IMAGE="hookwarden-e2e:$(git -C "$REPO" rev-parse --short HEAD)"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -t "$IMAGE" "$HERE"
fi

docker run --rm \
  -e "HW_VERSION=${HW_VERSION:-0.5.5}" \
  -v "$REPO/e2e/fixtures/phase-3:/fixtures:ro" \
  -v "$REPO/e2e/fixtures/perf/generated:/perf:ro" \
  "$IMAGE"
