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

  it("every entry has the D-33 array fields populated (secret_literal_prefix + conventional_paths may be empty)", () => {
    // Providers that legitimately have no canonical receiving URL. The spec/SDK identifies
    // the provider via headers + SDK package, not URL pattern. Listing a generic path like
    // "/webhook" here would cause false provider attribution against bare webhook routes
    // belonging to other providers (e.g. tied Stripe + standardwebhooks → provider="multiple").
    const noCanonicalPath = new Set(["standardwebhooks"]);
    for (const provider of Object.keys(PROVIDER_CATALOG)) {
      const entry = PROVIDER_CATALOG[provider];
      expect(entry, `provider ${provider}`).toBeDefined();
      expect(entry?.signature_header.length).toBeGreaterThan(0);
      expect(entry?.sdk_packages.length).toBeGreaterThan(0);
      expect(entry?.sdk_verify_calls.length).toBeGreaterThan(0);
      expect(entry?.secret_env_prefix.length).toBeGreaterThan(0);
      // D-95: secret_literal_prefix MAY be empty (e.g., Shopify webhook secrets have no
      // canonical prefix). When non-empty, it gates the hardcoded-secret-prefix rule.
      if (!noCanonicalPath.has(provider)) {
        expect(entry?.conventional_paths.length, `provider ${provider}`).toBeGreaterThan(0);
      }
    }
  });
});
