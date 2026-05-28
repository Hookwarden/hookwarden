# Clean Node 22 image — proves `hookwarden@<version>` installed fresh
# from npm Just Works against a real fixture corpus. Distinct from
# `e2e/phase-3.test.ts`, which runs `main(argv)` in-process via vitest.
#
# Build: docker build -t hookwarden-e2e .
# Run:   ../docker-smoke.sh   (mounts the fixtures + invokes this image)
FROM node:22-bookworm-slim
WORKDIR /test
RUN apt-get update \
 && apt-get install -y --no-install-recommends jq ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global user.email "e2e@hookwarden.local" \
 && git config --global user.name "hookwarden-e2e"
COPY test.sh /test/test.sh
RUN chmod +x /test/test.sh
ENTRYPOINT ["/test/test.sh"]
