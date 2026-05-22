// Phase 8.1 Plan 07: verify PROVIDER_CATALOG has PHP additions for v1 providers.
//
// Convention recap (see catalog.ts header):
//   - sdk_packages: PHP namespace prefixes appear as entries like `Stripe\\` (TypeScript source
//     escape; runtime value is one backslash). The engine substring/prefix-matches PHP imports
//     like `Stripe\Webhook` against these prefixes.
//   - sdk_verify_calls: PHP FQN call shapes appear as `Stripe\\Webhook::constructEvent` etc.
//
// Providers with no canonical PHP webhook SDK (github, slack) intentionally have no PHP
// additions — that's the contract.

import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/catalog.js";

describe("PROVIDER_CATALOG — PHP additions (Phase 8.1 Plan 07)", () => {
  it("stripe ships PHP namespace prefix + PHP FQN verify call shapes", () => {
    expect(PROVIDER_CATALOG.stripe?.sdk_packages).toContain("Stripe\\");
    expect(PROVIDER_CATALOG.stripe?.sdk_verify_calls).toContain("Stripe\\Webhook::constructEvent");
    expect(PROVIDER_CATALOG.stripe?.sdk_verify_calls).toContain("Webhook::constructEvent");
    expect(PROVIDER_CATALOG.stripe?.sdk_verify_calls).toContain(
      "Stripe\\WebhookSignature::verifyHeader",
    );
    // JS entries preserved.
    expect(PROVIDER_CATALOG.stripe?.sdk_packages).toContain("stripe");
    expect(PROVIDER_CATALOG.stripe?.sdk_verify_calls).toContain("webhooks.constructEvent");
  });

  it("shopify ships PHP namespace prefix + Shopify\\Utils::validateHmac", () => {
    expect(PROVIDER_CATALOG.shopify?.sdk_packages).toContain("Shopify\\");
    expect(PROVIDER_CATALOG.shopify?.sdk_verify_calls).toContain("Shopify\\Utils::validateHmac");
    // JS entries preserved.
    expect(PROVIDER_CATALOG.shopify?.sdk_packages).toContain("@shopify/shopify-api");
  });

  it("twilio ships PHP namespace prefix + Security\\RequestValidator::validate", () => {
    expect(PROVIDER_CATALOG.twilio?.sdk_packages).toContain("Twilio\\");
    expect(PROVIDER_CATALOG.twilio?.sdk_verify_calls).toContain(
      "Twilio\\Security\\RequestValidator::validate",
    );
    expect(PROVIDER_CATALOG.twilio?.sdk_verify_calls).toContain("RequestValidator::validate");
    // JS entry preserved.
    expect(PROVIDER_CATALOG.twilio?.sdk_packages).toContain("twilio");
  });

  it("square ships PHP namespace prefix + WebhooksHelper::isValidWebhookEventSignature", () => {
    expect(PROVIDER_CATALOG.square?.sdk_packages).toContain("Square\\");
    expect(PROVIDER_CATALOG.square?.sdk_verify_calls).toContain(
      "Square\\Utils\\WebhooksHelper::isValidWebhookEventSignature",
    );
    // JS entry preserved.
    expect(PROVIDER_CATALOG.square?.sdk_packages).toContain("square");
  });

  it("github intentionally has NO PHP additions — no canonical PHP webhook SDK", () => {
    // Documented contract: PHP github webhook verification is hand-rolled hash_hmac.
    // No "Octokit\\" or similar prefix; no PHP FQN verify call.
    const phpPrefixes = PROVIDER_CATALOG.github?.sdk_packages.filter((p) => p.includes("\\")) ?? [];
    expect(phpPrefixes).toEqual([]);
    const phpVerifyCalls = PROVIDER_CATALOG.github?.sdk_verify_calls.filter(
      (c) => c.includes("\\") || c.includes("::"),
    ) ?? [];
    expect(phpVerifyCalls).toEqual([]);
  });

  it("slack intentionally has NO PHP additions — no canonical PHP webhook SDK", () => {
    const phpPrefixes = PROVIDER_CATALOG.slack?.sdk_packages.filter((p) => p.includes("\\")) ?? [];
    expect(phpPrefixes).toEqual([]);
    const phpVerifyCalls = PROVIDER_CATALOG.slack?.sdk_verify_calls.filter(
      (c) => c.includes("\\") || c.includes("::"),
    ) ?? [];
    expect(phpVerifyCalls).toEqual([]);
  });

  it("every PHP namespace prefix entry in sdk_packages ends with a backslash (convention)", () => {
    for (const provider of Object.keys(PROVIDER_CATALOG)) {
      const entry = PROVIDER_CATALOG[provider];
      const phpPrefixes = entry?.sdk_packages.filter((p) => p.includes("\\")) ?? [];
      for (const prefix of phpPrefixes) {
        expect(prefix.endsWith("\\"), `provider ${provider} prefix ${prefix}`).toBe(true);
      }
    }
  });
});
