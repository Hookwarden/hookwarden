// Phase 27 (RULES-GO-01): verify PROVIDER_CATALOG has the Go SDK additions.
//
// Convention recap (see catalog.ts header + Phase 27):
//   - sdk_packages: Go module import paths appear as domain-prefixed entries like
//     `github.com/stripe/stripe-go` (NO trailing backslash — that's PHP). The engine matches Go
//     imports by import-path PREFIX (evidence.ts isGoImportPath), tolerating a /vNN/ segment.
//   - sdk_verify_calls: Go package-qualified call shapes appear as `webhook.ConstructEvent`,
//     `github.ValidatePayload`. The Svix/StandardWebhooks `wh.Verify(...)` instance shape is NOT a
//     static catalog string (receiver name varies) — it's detected by the import-gated Go overlay.
//
// The end-to-end sdk_verify_call EVIDENCE recognition (parse → buildProjectModel) is asserted in
// packages/engine/test/model/reachability-go.test.ts, where Go parsing (tree-sitter-go) is
// available — mirroring how the PHP evidence integration lives in the engine, not in catalog-php.

import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/catalog.js";

const GO_PATH_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+\//;

describe("PROVIDER_CATALOG — Go additions (Phase 27 RULES-GO-01)", () => {
  it("stripe ships the stripe-go module prefix + package-qualified verify calls", () => {
    expect(PROVIDER_CATALOG.stripe?.sdk_packages).toContain("github.com/stripe/stripe-go");
    expect(PROVIDER_CATALOG.stripe?.sdk_verify_calls).toContain("webhook.ConstructEvent");
    expect(PROVIDER_CATALOG.stripe?.sdk_verify_calls).toContain(
      "webhook.ConstructEventWithTolerance",
    );
    // JS + PHP entries preserved.
    expect(PROVIDER_CATALOG.stripe?.sdk_packages).toContain("stripe");
    expect(PROVIDER_CATALOG.stripe?.sdk_packages).toContain("Stripe\\");
    expect(PROVIDER_CATALOG.stripe?.sdk_verify_calls).toContain("webhooks.constructEvent");
  });

  it("github ships the go-github module prefix + validate calls", () => {
    expect(PROVIDER_CATALOG.github?.sdk_packages).toContain("github.com/google/go-github");
    expect(PROVIDER_CATALOG.github?.sdk_verify_calls).toContain("github.ValidatePayload");
    expect(PROVIDER_CATALOG.github?.sdk_verify_calls).toContain("github.ValidateSignature");
    // JS entries preserved.
    expect(PROVIDER_CATALOG.github?.sdk_packages).toContain("@octokit/webhooks");
  });

  it("standardwebhooks ships the Svix + Standard Webhooks Go module prefixes", () => {
    expect(PROVIDER_CATALOG.standardwebhooks?.sdk_packages).toContain(
      "github.com/svix/svix-webhooks/go",
    );
    expect(PROVIDER_CATALOG.standardwebhooks?.sdk_packages).toContain(
      "github.com/standard-webhooks/standard-webhooks/libraries/go",
    );
    // The Go instance Verify shape is NOT a static catalog string — detected by the import-gated
    // overlay. A bare "Verify" would over-match any .Verify() via reachable_symbols, so it must
    // be absent here.
    expect(PROVIDER_CATALOG.standardwebhooks?.sdk_verify_calls).not.toContain("Verify");
  });

  it("Go sdk_packages are domain-prefixed module paths, never PHP namespaces", () => {
    for (const provider of ["stripe", "github", "standardwebhooks"] as const) {
      const goPkgs =
        PROVIDER_CATALOG[provider]?.sdk_packages.filter((p) => GO_PATH_RE.test(p)) ?? [];
      expect(goPkgs.length).toBeGreaterThan(0);
      for (const pkg of goPkgs) {
        expect(pkg).not.toContain("\\"); // not a PHP namespace
        expect(pkg.startsWith("@")).toBe(false); // not an npm scoped package
      }
    }
  });

  it("providers without a Go webhook SDK have no Go module entries (contract)", () => {
    // slack/twilio verify by hand or via non-Go SDKs; no Go module path should be present.
    for (const provider of ["slack", "twilio"] as const) {
      const goPkgs =
        PROVIDER_CATALOG[provider]?.sdk_packages.filter((p) => GO_PATH_RE.test(p)) ?? [];
      expect(goPkgs).toEqual([]);
    }
  });
});
