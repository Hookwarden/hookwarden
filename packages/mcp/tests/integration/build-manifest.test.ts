// Plan 23-03 Task 1 Tests — build-manifest.json shape + round-trip + idempotency.
//
// Runs after `pnpm --filter @hookwarden/mcp build` (which the verify gate
// invokes upstream). These tests gate on the emitted dist/build-manifest.json
// against the BuildManifest type contract Plan 23-02 declared in src/types.ts.

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { checkDrift, loadBuildManifest } from "../../src/drift-check.js";
import type { BuildManifest } from "../../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(PKG_ROOT, "dist", "build-manifest.json");
const EMIT_SCRIPT = path.join(PKG_ROOT, "scripts", "emit-build-manifest.mjs");

describe("dist/build-manifest.json — shape contract (Test 1)", () => {
  let manifest: BuildManifest;

  beforeAll(async () => {
    // Ensure the manifest exists (CI runs build first; locally a stale
    // dist/ might not have one yet). The emit script is idempotent.
    if (!(await fs.stat(MANIFEST_PATH).catch(() => null))) {
      execSync(`node ${EMIT_SCRIPT}`, { cwd: PKG_ROOT });
    }
    const raw = await fs.readFile(MANIFEST_PATH, "utf-8");
    manifest = JSON.parse(raw) as BuildManifest;
  });

  it("declares engine.version = 0.7.4 with content_hash null", () => {
    expect(manifest.engine.version).toBe("0.7.4");
    expect(manifest.engine.content_hash).toBeNull();
  });

  it("declares rules.version = 0.7.4 with a 64-char SHA-256 hex content_hash", () => {
    expect(manifest.rules.version).toBe("0.7.4");
    expect(manifest.rules.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("declares built_at as a parseable ISO-8601 timestamp", () => {
    expect(typeof manifest.built_at).toBe("string");
    const parsed = new Date(manifest.built_at);
    expect(parsed.getTime()).not.toBeNaN();
    expect(parsed.toISOString()).toBe(manifest.built_at);
  });
});

describe("dist/build-manifest.json — round-trip with drift-check (Test 2)", () => {
  it("checkDrift returns null when run against the just-emitted manifest", async () => {
    // Defensive re-emit so the manifest reflects the CURRENT runtime state
    // (not a stale build artifact from a prior session).
    execSync(`node ${EMIT_SCRIPT}`, { cwd: PKG_ROOT });
    const manifest = await loadBuildManifest(MANIFEST_PATH);
    const result = await checkDrift(manifest);
    expect(result).toBeNull();
  });
});

describe("emit-build-manifest.mjs — idempotency (Test 3)", () => {
  it("two consecutive emits produce the same rules.content_hash", async () => {
    execSync(`node ${EMIT_SCRIPT}`, { cwd: PKG_ROOT });
    const firstRaw = await fs.readFile(MANIFEST_PATH, "utf-8");
    const first = JSON.parse(firstRaw) as BuildManifest;

    execSync(`node ${EMIT_SCRIPT}`, { cwd: PKG_ROOT });
    const secondRaw = await fs.readFile(MANIFEST_PATH, "utf-8");
    const second = JSON.parse(secondRaw) as BuildManifest;

    // built_at intentionally varies (ISO timestamp of the emit run); the
    // content_hash MUST be deterministic — canonical JSON encoding +
    // SHA-256 is deterministic for fixed inputs.
    expect(second.rules.content_hash).toBe(first.rules.content_hash);
    expect(second.engine.version).toBe(first.engine.version);
    expect(second.rules.version).toBe(first.rules.version);
  });
});
