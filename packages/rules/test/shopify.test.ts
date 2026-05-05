// 06.2 — Shopify rule pack predicate tests. Synthetic baseHandler + sym() pattern matches
// stripe-predicates.test.ts; the parameterized factories shipped in 06.1 are exercised
// against shopify-bound exports. No fixture file loading — those live under
// test/fixtures/shopify/ as documentation + future e2e material.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { shopifyLibraryVerifiedPredicate } from "../src/predicates/library-verified-recognition.js";
import { shopifyMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { shopifyMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { shopifyRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { shopifyTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { shopifyUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { shopifyWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/shopify",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "shopifyWebhook",
  provider: "shopify",
  verification_state: "manual-review",
  evidence: [],
  middleware_chain: [],
  reachable_symbols: [],
  findings_ref: [],
  redacted_snippet: "",
};

const sym = (qualified_name: string, import_source: string | null = null): ReachableSymbol => ({
  qualified_name,
  import_source,
  hops: 1,
  via: "direct call",
});

const ev = (kind: WebhookEvidence["kind"], provider = "shopify"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("shopifyMissingSignatureVerificationPredicate (RULES-01)", () => {
  it("emits not-verified when no SDK or manual HMAC reachable", async () => {
    expect(await shopifyMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when shopify.webhooks.validate is reachable from @shopify/shopify-api", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("shopify.webhooks.validate", "@shopify/shopify-api")],
    };
    expect(await shopifyMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when verifyHmac is reachable from @shopify/shopify-api", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("verifyHmac", "@shopify/shopify-api")],
    };
    expect(await shopifyMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when verifyHmac matches but import_source is wrong", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("verifyHmac", "@some-other/lib")],
    };
    expect(await shopifyMissingSignatureVerificationPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac is reachable (manual path defers)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await shopifyMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-shopify provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await shopifyMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("shopifyTimingUnsafeComparisonPredicate (RULES-02)", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await shopifyTimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when timingSafeEqual reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await shopifyTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("shopify.webhooks.validate", "@shopify/shopify-api")],
    };
    expect(await shopifyTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
});

describe("shopifyRawBodyMisusePredicate (RULES-03)", () => {
  it("emits not-verified when attempting verification but no raw-body evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await shopifyRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes_or_buffer evidence present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer", "shopify")],
    };
    expect(await shopifyRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when handler not attempting verification", async () => {
    expect(await shopifyRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("shopifyMissingTimestampCheckPredicate (RULES-04)", () => {
  it("emits manual-review when manual HMAC reachable and no timestamp symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await shopifyMissingTimestampCheckPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("shopify.webhooks.validate", "@shopify/shopify-api")],
    };
    expect(await shopifyMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
});

describe("shopifyWrongHmacAlgorithmPredicate (RULES-05)", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await shopifyWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await shopifyWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("WR-01 manual-review when both expected and wrong reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("hash.sha256"),
        sym("hash.sha512"),
      ],
    };
    expect(await shopifyWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("manual-review");
  });
});

describe("shopifyUnreachableVerificationPredicate (RULES-07)", () => {
  it("emits manual-review when sdk_import evidence present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await shopifyUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_import")],
      reachable_symbols: [sym("shopify.webhooks.validate", "@shopify/shopify-api")],
    };
    expect(await shopifyUnreachableVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("shopifyLibraryVerifiedPredicate (RULES-04)", () => {
  it("emits verified when shopify.webhooks.validate is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("shopify.webhooks.validate", "@shopify/shopify-api")],
    };
    expect(await shopifyLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
  });
  it("returns null when no SDK verify reachable", async () => {
    expect(await shopifyLibraryVerifiedPredicate(baseHandler, {} as never)).toBeNull();
  });
});
