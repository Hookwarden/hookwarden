// Plan 23-02 Task 1 Tests 3 + 6 — rules version drift.
//
// Same pattern as drift-engine.test.ts: vi.mock substitutes
// RULES_PACK_VERSION; the fixture stub at
// tests/fixtures/drift/node_modules/@hookwarden/rules/package.json#version
// is the source-of-truth for the stale version literal.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_RULES_PKG = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "drift",
  "node_modules",
  "@hookwarden",
  "rules",
  "package.json",
);

const STALE_RULES_VERSION = "0.6.0";

vi.mock("@hookwarden/rules", async () => {
  const real = await vi.importActual<typeof import("@hookwarden/rules")>("@hookwarden/rules");
  return { ...real, RULES_PACK_VERSION: STALE_RULES_VERSION };
});

const { checkDrift } = await import("../../src/drift-check.js");

describe("checkDrift — rules version drift (Tests 3 + 6)", () => {
  beforeAll(async () => {
    const fixturePkg = JSON.parse(await fs.readFile(FIXTURE_RULES_PKG, "utf-8"));
    expect(fixturePkg.version).toBe(STALE_RULES_VERSION);
  });

  it("returns rules_drift payload with all 4 required fields when rules version mismatches", async () => {
    const manifest = {
      engine: { version: "9.99.99-irrelevant", content_hash: null as null },
      rules: { version: "0.7.0", content_hash: "0".repeat(64) },
      built_at: "2026-05-30T00:00:00Z",
    } as const;

    // Note: the engine version above will ALSO mismatch the real ENGINE_VERSION
    // (0.7.0), but checkDrift short-circuits on the first mismatch — engine is
    // checked before rules. We need engine.version === ENGINE_VERSION here to
    // exercise the rules path. Re-set:
    const realisticManifest = {
      ...manifest,
      engine: {
        version: (await import("@hookwarden/engine")).ENGINE_VERSION,
        content_hash: null as null,
      },
    };

    const result = await checkDrift(realisticManifest);

    expect(result).not.toBeNull();
    expect(result?.error).toBe("rules_drift");
    expect(result?.component).toBe("rules");
    expect(result?.pinned).toBe("0.7.0");
    expect(result?.current).toBe(STALE_RULES_VERSION);
    expect(result?.suggestion).toBeTruthy();
    expect(result?.rationale).toMatch(/Rule-pack content/);
  });
});
