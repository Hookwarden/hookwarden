// 08.3 Plan 09 — Datadog rule pack predicate tests.
// Datadog uses the raw_body signing scheme with a dedicated `X-Datadog-Signature`
// header (no cross-provider attribution risk). Modelled on linear.test.ts —
// Linear is the closest analog (same raw_body + sha256 + hex shape, same
// no-canonical-SDK / no-timestamp-header story).
//
// Test budget per Phase 6 D-09: ~22 tests across the 6 predicates with the
// 5-positive / 8-negative / 3-manual-review / 6-SOC2-evidence-bearing split
// from feedback_negative_tests_required.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { datadogMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { datadogMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { datadogRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { datadogTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { datadogUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { datadogWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/datadog/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "datadogWebhook",
  provider: "datadog",
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

const ev = (kind: WebhookEvidence["kind"], provider = "datadog"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("datadogMissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no manual HMAC reachable (Datadog has no canonical SDK)", async () => {
    expect(await datadogMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac (Node manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await datadogMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.new (Python manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await datadogMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-datadog provider (contract-violation: predicate must be provider-scoped)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await datadogMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when inline-middleware sdk_verify_call evidence is present (provider-attributed)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(await datadogMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (adversary-shaped attribution)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "github")],
    };
    expect(await datadogMissingSignatureVerificationPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
});

describe("datadogTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await datadogTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await datadogTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.compare_digest (Python) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("hmac.compare_digest", "hmac")],
    };
    expect(await datadogTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC is reachable (purity-fail-loudly — predicate must not fire blindly)", async () => {
    expect(await datadogTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("datadogRawBodyMisusePredicate", () => {
  it("emits not-verified when verification is attempted but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await datadogRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await datadogRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no verification is being attempted (input rejection — only flag attempts)", async () => {
    expect(await datadogRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("datadogMissingTimestampCheckPredicate (D-91 null timestamp_header — delivery-ID dedup analog)", () => {
  // Datadog sends no timestamp header. The factory still fires manual-review
  // when manual HMAC is reachable and no Date.now/time.time symbol is reachable;
  // the YAML message steers users toward delivery-ID dedup rather than tolerance windows.
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await datadogMissingTimestampCheckPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when Date.now reachable alongside manual HMAC (Node)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await datadogMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await datadogMissingTimestampCheckPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("datadogWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await datadogWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when wrong algorithm (.sha1) reachable — boundary algo", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await datadogWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await datadogWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable", async () => {
    expect(await datadogWrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("WR-01: emits manual-review when BOTH sha256 and sha1 reachable (ambiguous attribution)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("hash.sha256"),
        sym("hash.sha1"),
      ],
    };
    expect(await datadogWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("manual-review");
  });
});

describe("datadogUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await datadogUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence (no claim of intent)", async () => {
    expect(await datadogUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});
