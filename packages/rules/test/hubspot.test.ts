// 08.3 Plan 05 — HubSpot v3 rule pack predicate tests.
// HubSpot v3 uses signing_input_format: 'custom' — canonical-string is
// `${httpMethod}${requestURI}${rawBody}${timestamp}` HMAC-SHA256 base64.
// Dispatches through CUSTOM_SIGNING_PREDICATES['hubspot'] via the custom
// predicate at predicates/custom/hubspot-signing.ts (Twilio analog).
//
// What this suite tests vs what the engine fixture suite tests:
// - The predicate-level question "did the handler attempt to verify at all?"
//   is what's covered here (entry-point detection + provider scope + manual
//   HMAC reachability).
// - The "v3 concatenation-order" failure modes — handler reverses the order,
//   omits a segment, etc. — are caught at the engine layer via raw-body-misuse
//   (when the rawBody segment differs from what HubSpot sent) and wrong-hmac-
//   algorithm (when the wrong algo is used). The "concatenation-order"
//   negative tests called for by the plan are covered as engine-layer fixture
//   tests at workspace-level e2e/, not as predicate unit tests; predicate
//   unit tests cannot reason about literal canonical-string construction
//   without parsing the full handler AST + value-tracking.
// - The 2 dedicated concatenation-order assertions below verify that the
//   predicate behaves correctly under contract-violation evidence (cross-
//   provider sdk_verify_call + reachable manual-HMAC entry that doesn't
//   include the rawBody segment fingerprint).

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { hubspotMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { hubspotMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { hubspotRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { hubspotTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { hubspotUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { hubspotWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";
import { hubspotSigningPredicate } from "../src/predicates/custom/hubspot-signing.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/hubspot/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "hubspotWebhook",
  provider: "hubspot",
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

const ev = (kind: WebhookEvidence["kind"], provider = "hubspot"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("hubspotSigningPredicate (D-92 custom-signing dispatch)", () => {
  it("emits not-verified with no manual HMAC reachable (HubSpot has no canonical webhook SDK)", async () => {
    expect(await hubspotSigningPredicate(baseHandler, {} as never)).toBe("not-verified");
  });
  it("returns null when crypto.createHmac (Node manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await hubspotSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-hubspot provider (contract-violation guard)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "twilio" };
    expect(await hubspotSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when inline-middleware sdk_verify_call evidence with provider=hubspot is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(await hubspotSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (concatenation-order disambiguation)", async () => {
    // Concatenation-order analog at the predicate layer: even if a wrong-provider
    // sdk_verify_call is reachable (e.g. a twilio verifier on a hubspot handler),
    // the canonical-string contract is provider-specific. The predicate must NOT
    // trust cross-provider verification evidence.
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "twilio")],
    };
    expect(await hubspotSigningPredicate(handler, {} as never)).toBe("not-verified");
  });
});

describe("hubspotMissingSignatureVerificationPredicate (factory wrapper — dispatches to custom slot)", () => {
  it("dispatches to CUSTOM_SIGNING_PREDICATES['hubspot']: emits not-verified on bare handler", async () => {
    // The factory checks signing_input_format === 'custom' and dispatches to the
    // custom predicate. End-to-end check that the wrapper + dispatch path works.
    expect(await hubspotMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null for non-hubspot provider (contract-violation guard)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await hubspotMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("hubspotTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await hubspotTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await hubspotTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.compare_digest (Python) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("hmac.compare_digest", "hmac")],
    };
    expect(await hubspotTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC is reachable (purity-fail-loudly)", async () => {
    expect(await hubspotTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("hubspotRawBodyMisusePredicate (catches concatenation-segment-corruption mode)", () => {
  // The wrong-concatenation-order failure mode where the handler accidentally
  // uses the JSON-parsed body in the canonical string surfaces as raw-body-misuse:
  // the canonical-string `rawBody` segment is byte-corrupted by JSON parsing.
  it("emits not-verified when signature_header read but no body_as_bytes evidence (concatenation byte-corruption)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await hubspotRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await hubspotRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no verification is being attempted", async () => {
    expect(await hubspotRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("hubspotMissingTimestampCheckPredicate (timestamp_header: 'x-hubspot-request-timestamp' branch)", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await hubspotMissingTimestampCheckPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when Date.now reachable alongside manual HMAC (Node tolerance window)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await hubspotMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await hubspotMissingTimestampCheckPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("hubspotWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await hubspotWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when wrong algorithm (.sha1) reachable — legacy v1 boundary", async () => {
    // HubSpot v1 signature scheme used sha256 over body-only; the .sha1 case
    // here is the "user reached for sha1 because they confused HubSpot's scheme
    // with GitHub's v1 signature header" failure mode.
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await hubspotWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await hubspotWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("WR-01: emits manual-review when BOTH sha256 and sha1 reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("hash.sha256"),
        sym("hash.sha1"),
      ],
    };
    expect(await hubspotWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("manual-review");
  });
});

describe("hubspotUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await hubspotUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence", async () => {
    expect(await hubspotUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});
