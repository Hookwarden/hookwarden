import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { stripeMissingSignatureVerificationPredicate } from "../../src/predicates/stripe-missing-signature-verification.js";
import { stripeMissingTimestampCheckPredicate } from "../../src/predicates/stripe-missing-timestamp-check.js";
import { stripeRawBodyMisusePredicate } from "../../src/predicates/stripe-raw-body-misuse.js";
import { stripeTimingUnsafeComparisonPredicate } from "../../src/predicates/stripe-timing-unsafe-comparison.js";
import { stripeUnreachableVerificationPredicate } from "../../src/predicates/stripe-unreachable-verification.js";
import { stripeWrongHmacAlgorithmPredicate } from "../../src/predicates/stripe-wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/stripe",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "handleStripe",
  provider: "stripe",
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

const ev = (kind: WebhookEvidence["kind"], provider = "stripe", detail = "x"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail,
});

describe("stripeMissingSignatureVerificationPredicate (RULES-02 #1)", () => {
  it("emits not-verified when neither SDK verify nor manual HMAC is reachable", async () => {
    expect(await stripeMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when stripe.webhooks.constructEvent is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("stripe.webhooks.constructEvent", "stripe")],
    };
    expect(await stripeMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when crypto.createHmac is reachable (manual path defers)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await stripeMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when Python hmac.new is reachable (manual path defers)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await stripeMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-stripe provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "github" };
    expect(await stripeMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("stripeTimingUnsafeComparisonPredicate (RULES-02 #2)", () => {
  it("emits not-verified when manual HMAC reachable but timingSafeEqual is not", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await stripeTimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when crypto.timingSafeEqual is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await stripeTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when SDK constructEvent is reachable (SDK exempt)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("stripe.webhooks.constructEvent", "stripe")],
    };
    expect(await stripeTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC entry is reachable", async () => {
    expect(await stripeTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
  // B-2: Python parity — `hmac.new(...)` MUST register as a manual HMAC entry, otherwise the
  // canonical Python timing-unsafe pattern produces ZERO findings.
  it("emits not-verified when Python hmac.new reachable but compare_digest is not", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await stripeTimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when Python hmac.new + hmac.compare_digest are both reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("hmac.compare_digest", "hmac")],
    };
    expect(await stripeTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-stripe provider", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "github",
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await stripeTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
});

describe("stripeRawBodyMisusePredicate (RULES-02 #3)", () => {
  it("emits not-verified when handler reads signature header but lacks raw body evidence", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("signature_header_read")] };
    expect(await stripeRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when handler calls SDK verify but lacks raw body evidence", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_verify_call")] };
    expect(await stripeRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes_or_buffer evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await stripeRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when handler is not attempting verification (no header read, no sdk call)", async () => {
    expect(await stripeRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null when signature_header_read evidence is for a different provider", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read", "github")],
    };
    expect(await stripeRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-stripe provider", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "github",
      evidence: [ev("signature_header_read", "github")],
    };
    expect(await stripeRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("stripeMissingTimestampCheckPredicate (RULES-02 #4)", () => {
  it("emits manual-review when manual HMAC reachable + no timestamp symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await stripeMissingTimestampCheckPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when SDK constructEvent is reachable (SDK enforces tolerance)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("stripe.webhooks.constructEvent", "stripe")],
    };
    expect(await stripeMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when Date.now is reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await stripeMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when time.time is reachable alongside Python hmac.new", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("time.time", "time")],
    };
    expect(await stripeMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC path is reachable", async () => {
    expect(await stripeMissingTimestampCheckPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("stripeWrongHmacAlgorithmPredicate (RULES-02 #5)", () => {
  it("emits not-verified when a non-sha256 algorithm symbol (.md5) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.md5")],
    };
    expect(await stripeWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when .sha512 is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await stripeWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when .sha256 is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await stripeWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("emits manual-review when manual HMAC reachable but algorithm is undetermined", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await stripeWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when no manual HMAC path is reachable", async () => {
    expect(await stripeWrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("stripeUnreachableVerificationPredicate (RULES-02 #7)", () => {
  it("emits manual-review when stripe SDK is imported but constructEvent is unreachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await stripeUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when constructEvent IS reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_import")],
      reachable_symbols: [sym("stripe.webhooks.constructEvent", "stripe")],
    };
    expect(await stripeUnreachableVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when stripe SDK is not imported", async () => {
    expect(await stripeUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null when sdk_import evidence is for a different provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import", "github")] };
    expect(await stripeUnreachableVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-stripe provider", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "github",
      evidence: [ev("sdk_import", "github")],
    };
    expect(await stripeUnreachableVerificationPredicate(handler, {} as never)).toBeNull();
  });
});
