// 06.5 — Square rule pack predicate tests. Square uses signing_input_format
// 'custom_field_tuple' (URL+body); no custom predicate slot, no missing-timestamp-check
// (Square scheme has no timestamp), no hardcoded-secret-prefix (D-95 verification: webhook
// signature keys have no canonical prefix).

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { squareLibraryVerifiedPredicate } from "../src/predicates/library-verified-recognition.js";
import { squareMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { squareRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { squareTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { squareUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { squareWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/square",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "squareWebhook",
  provider: "square",
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

const ev = (kind: WebhookEvidence["kind"], provider = "square"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("squareMissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no SDK or manual HMAC", async () => {
    expect(await squareMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when WebhooksHelper.verifySignature reachable from 'square' package", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("WebhooksHelper.verifySignature", "square")],
    };
    expect(await squareMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when is_valid_webhook_event_signature reachable from 'squareup'", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("is_valid_webhook_event_signature", "squareup")],
    };
    expect(await squareMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-square provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await squareMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("squareTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await squareTimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when timingSafeEqual reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await squareTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
});

describe("squareRawBodyMisusePredicate", () => {
  it("emits not-verified when attempting verification but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("signature_header_read")] };
    expect(await squareRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
});

describe("squareWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await squareWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await squareWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
});

describe("squareUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await squareUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
});

describe("squareLibraryVerifiedPredicate", () => {
  it("emits verified when WebhooksHelper.verifySignature is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("WebhooksHelper.verifySignature", "square")],
    };
    expect(await squareLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
  });
});
