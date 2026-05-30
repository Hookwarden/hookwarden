// Plan 23-02 Task 1 Tests 2 + 5 — engine version drift.
//
// vi.mock substitutes the @hookwarden/engine ENGINE_VERSION export at the
// per-file module-graph level. The fixture stub at
// tests/fixtures/drift/node_modules/@hookwarden/engine/package.json#version
// is the source-of-truth for the stale-version literal we mock in.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ENGINE_PKG = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "drift",
  "node_modules",
  "@hookwarden",
  "engine",
  "package.json",
);

const STALE_ENGINE_VERSION = "0.6.5";

vi.mock("@hookwarden/engine", async () => {
  const real = await vi.importActual<typeof import("@hookwarden/engine")>("@hookwarden/engine");
  return { ...real, ENGINE_VERSION: STALE_ENGINE_VERSION };
});

const { checkDrift } = await import("../../src/drift-check.js");

describe("checkDrift — engine version drift (Tests 2 + 5)", () => {
  beforeAll(async () => {
    // Sanity: the fixture's package.json must declare the stale version
    // we're mocking against — keeps the test self-validating per
    // [[feedback_negative_tests_required]] (mock and fixture cannot diverge).
    const fixturePkg = JSON.parse(await fs.readFile(FIXTURE_ENGINE_PKG, "utf-8"));
    expect(fixturePkg.version).toBe(STALE_ENGINE_VERSION);
  });

  it("returns engine_drift payload with all 4 required fields when engine version mismatches", async () => {
    const manifest = {
      engine: { version: "0.7.0", content_hash: null as null },
      rules: { version: "0.7.0", content_hash: "0".repeat(64) },
      built_at: "2026-05-30T00:00:00Z",
    } as const;

    const result = await checkDrift(manifest);

    expect(result).not.toBeNull();
    expect(result?.error).toBe("engine_drift");
    expect(result?.component).toBe("engine");
    expect(result?.pinned).toBe("0.7.0");
    expect(result?.current).toBe(STALE_ENGINE_VERSION);
    expect(result?.suggestion).toBeTruthy();
    expect(result?.rationale).toBeTruthy();
    // Rationale must explain WHY drift matters, not just restate the mismatch.
    expect(result?.rationale).toMatch(/engine version/i);
  });
});
