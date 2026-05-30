// Plan 23-02 Task 1 Tests 1, 4, 7 — drift-check shape contract.
// Engine + rules version-mismatch scenarios are exercised in the sibling
// integration test files (drift-engine.test.ts, drift-rules.test.ts) where
// vi.mock substitutes the version constant per file scope.

import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "@hookwarden/engine";
import {
  BUNDLED_RULE_DOCUMENTS,
  PROVIDER_CATALOG,
  RULES_PACK_VERSION,
  computeContentHash,
  validateRuleDocument,
} from "@hookwarden/rules";

import { checkDrift, loadBuildManifest } from "../../src/drift-check.js";
import type { BuildManifest } from "../../src/types.js";

async function realHash(): Promise<string> {
  const parsed = BUNDLED_RULE_DOCUMENTS.map((entry) => validateRuleDocument(entry.doc));
  return computeContentHash(PROVIDER_CATALOG, parsed);
}

async function realManifest(overrides?: Partial<BuildManifest["rules"]>): Promise<BuildManifest> {
  return {
    engine: { version: ENGINE_VERSION, content_hash: null },
    rules: {
      version: RULES_PACK_VERSION,
      content_hash: await realHash(),
      ...overrides,
    },
    built_at: "2026-05-30T00:00:00Z",
  };
}

describe("checkDrift — no drift (Test 1)", () => {
  it("returns null when manifest matches runtime engine + rules + content-hash", async () => {
    const result = await checkDrift(await realManifest());
    expect(result).toBeNull();
  });
});

describe("checkDrift — rules content-hash drift (Test 4)", () => {
  it("returns rules_drift with SHA256 hex pinned/current when content hash differs but version matches", async () => {
    const fakeHash = "0".repeat(64);
    const manifest = await realManifest({ content_hash: fakeHash });
    const result = await checkDrift(manifest);
    expect(result).not.toBeNull();
    expect(result?.error).toBe("rules_drift");
    expect(result?.component).toBe("rules");
    expect(result?.pinned).toBe(fakeHash);
    // current MUST be a SHA256 hex string (64 lowercase hex chars)
    expect(result?.current).toMatch(/^[0-9a-f]{64}$/);
    expect(result?.suggestion).toContain("npm i -g @hookwarden/mcp");
    expect(result?.rationale).toMatch(/Bundled rule YAML content has changed/);
  });
});

describe("loadBuildManifest — missing manifest (Test 7)", () => {
  it("throws a structured error pointing at the reinstall command", async () => {
    // Use an explicit guaranteed-missing path. The default-path overload would
    // race with the sibling boot-drift-stderr.test.ts which writes a synthetic
    // manifest into the same file.
    const missing = "/tmp/hookwarden-mcp-nonexistent-manifest-for-test.json";
    await expect(loadBuildManifest(missing)).rejects.toThrow(/build-manifest missing/);
    await expect(loadBuildManifest(missing)).rejects.toThrow(/npm i -g @hookwarden\/mcp@latest/);
  });
});
