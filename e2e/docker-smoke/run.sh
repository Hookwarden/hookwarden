#!/bin/bash
# Wrapper: build the Docker image (if missing) and run the smoke against
# the local fixture corpus. Default smokes the latest published version;
# pin a specific version with `HW_VERSION=0.7.5 ./e2e/docker-smoke/run.sh`
# for backwards-compat checks against an older artifact.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
IMAGE="hookwarden-e2e:$(git -C "$REPO" rev-parse --short HEAD)"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -t "$IMAGE" "$HERE"
fi

docker run --rm \
  -e "HW_VERSION=${HW_VERSION:-latest}" \
  -v "$REPO/e2e/fixtures/phase-3:/fixtures:ro" \
  -v "$REPO/e2e/fixtures/perf/generated:/perf:ro" \
  "$IMAGE"
