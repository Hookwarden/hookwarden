import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/catalog.js";

describe("PROVIDER_CATALOG (D-33)", () => {
  it("ships entries for stripe and github (the Phase 3 providers)", () => {
    expect(PROVIDER_CATALOG.stripe).toBeDefined();
    expect(PROVIDER_CATALOG.github).toBeDefined();
  });

  it("stripe entry includes whsec_ secret literal prefix (used by Phase 11 leak-scan)", () => {
    expect(PROVIDER_CATALOG.stripe?.secret_literal_prefix).toContain("whsec_");
  });

  it("github entry includes x-hub-signature-256 signature header", () => {
    expect(PROVIDER_CATALOG.github?.signature_header).toContain("x-hub-signature-256");
  });

  it("every entry has all six D-33 fields populated (no empty arrays)", () => {
    for (const provider of Object.keys(PROVIDER_CATALOG)) {
      const entry = PROVIDER_CATALOG[provider];
      expect(entry, `provider ${provider}`).toBeDefined();
      expect(entry?.signature_header.length).toBeGreaterThan(0);
      expect(entry?.sdk_packages.length).toBeGreaterThan(0);
      expect(entry?.sdk_verify_calls.length).toBeGreaterThan(0);
      expect(entry?.secret_env_prefix.length).toBeGreaterThan(0);
      expect(entry?.secret_literal_prefix.length).toBeGreaterThan(0);
      expect(entry?.conventional_paths.length).toBeGreaterThan(0);
    }
  });
});
