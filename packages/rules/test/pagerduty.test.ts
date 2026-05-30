// 08.3 Plan 11 — PagerDuty v3 rule pack predicate tests.
// PagerDuty uses the raw_body signing scheme with a dedicated `X-PagerDuty-Signature`
// header (no cross-provider attribution risk). The header value is comma-separated
// `v1=<hex>,v1=<hex>` during key rotation — flagged by the dedicated
// `pagerduty-multi-signature-rotation-mishandled` rule.
//
// Six baseline rules modelled on linear/datadog/sentry; the seventh
// (multi-signature-rotation-mishandled) is PagerDuty-specific.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { pagerdutyMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { pagerdutyMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { pagerdutyMultiSignatureRotationMishandledPredicate } from "../src/predicates/pagerduty-multi-signature.js";
import { pagerdutyRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { pagerdutyTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { pagerdutyUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { pagerdutyWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/pagerduty/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "pagerdutyWebhook",
  provider: "pagerduty",
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

const ev = (kind: WebhookEvidence["kind"], provider = "pagerduty"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("pagerdutyMissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no manual HMAC reachable (PagerDuty has no canonical SDK)", async () => {
    expect(await pagerdutyMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac (Node manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await pagerdutyMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.new (Python manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await pagerdutyMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-pagerduty provider (contract-violation)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await pagerdutyMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (adversary-shaped attribution)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "github")],
    };
    expect(await pagerdutyMissingSignatureVerificationPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
});

describe("pagerdutyTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await pagerdutyTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.timingSafeEqual reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await pagerdutyTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC is reachable (purity-fail-loudly)", async () => {
    expect(await pagerdutyTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("pagerdutyRawBodyMisusePredicate", () => {
  it("emits not-verified when verification is attempted but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await pagerdutyRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await pagerdutyRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("pagerdutyMissingTimestampCheckPredicate (D-91 null timestamp_header — delivery-ID dedup analog)", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await pagerdutyMissingTimestampCheckPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when Date.now reachable alongside manual HMAC (Node)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await pagerdutyMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
});

describe("pagerdutyWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await pagerdutyWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await pagerdutyWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable", async () => {
    expect(await pagerdutyWrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("pagerdutyUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await pagerdutyUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence", async () => {
    expect(await pagerdutyUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("pagerdutyMultiSignatureRotationMishandledPredicate (NEW Plan 11 rule)", () => {
  it("emits manual-review when manual HMAC reachable but no .split / iteration symbol", async () => {
    // The classic rotation bug: handler computes HMAC, compares against the entire
    // X-PagerDuty-Signature value or just the first token. No .split / .forEach / etc.
    // appears in reachable_symbols.
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await pagerdutyMultiSignatureRotationMishandledPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when manual HMAC AND String.prototype.split are both reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("String.prototype.split")],
    };
    expect(
      await pagerdutyMultiSignatureRotationMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when manual HMAC AND Array.prototype.forEach are both reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Array.prototype.forEach")],
    };
    expect(
      await pagerdutyMultiSignatureRotationMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when manual HMAC AND Array.prototype.some (early-exit iteration) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Array.prototype.some")],
    };
    expect(
      await pagerdutyMultiSignatureRotationMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when manual HMAC AND PHP explode() reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("explode")],
    };
    expect(
      await pagerdutyMultiSignatureRotationMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly — only fire when verification IS attempted)", async () => {
    expect(
      await pagerdutyMultiSignatureRotationMishandledPredicate(baseHandler, {} as never),
    ).toBeNull();
  });
  it("returns null for non-pagerduty provider (contract-violation — provider-scoped)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(
      await pagerdutyMultiSignatureRotationMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
});
