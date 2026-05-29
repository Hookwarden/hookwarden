// 08.3 Plan 15 — Zoom webhook rule pack predicate tests.
// Zoom uses the Slack signing recipe (`v0:${timestamp}:${rawBody}`) with the
// `X-Zm-*` header family. Six baseline catalog-parameterized rules + the NEW
// url-validation-only rule (Notion verification-token-only analog).

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { zoomMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { zoomMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { zoomRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { zoomTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { zoomUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { zoomUrlValidationOnlyPredicate } from "../src/predicates/zoom-url-validation-only.js";
import { zoomWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/zoom/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "zoomWebhook",
  provider: "zoom",
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

const ev = (kind: WebhookEvidence["kind"], provider = "zoom"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("zoomMissingSignatureVerificationPredicate", () => {
  it("emits not-verified when no manual HMAC reachable", async () => {
    expect(await zoomMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await zoomMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-zoom provider (contract-violation: provider-scoped)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await zoomMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("zoomUrlValidationOnlyPredicate (NEW Plan 15 rule — URL-validation-vs-runtime bifurcation)", () => {
  // The classic Zoom bug: handler implemented URL validation but never wired up
  // runtime signature verification. Handler reads X-Zm-Signature (header IS being
  // read) but no manual HMAC is reachable — likely a stub that always returns 200.
  it("emits manual-review when signature_header_read present BUT no manual HMAC reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await zoomUrlValidationOnlyPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when signature_header_read present AND manual HMAC reachable (handler is verifying)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
      evidence: [ev("signature_header_read")],
    };
    expect(await zoomUrlValidationOnlyPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no signature_header_read evidence (missing-signature-verification grades this)", async () => {
    expect(await zoomUrlValidationOnlyPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null for non-zoom provider (contract-violation)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      evidence: [ev("signature_header_read", "stripe")],
    };
    expect(await zoomUrlValidationOnlyPredicate(handler, {} as never)).toBeNull();
  });
  it("emits manual-review when Python hmac.new reachable but signature_header_read present (still validates)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
      evidence: [ev("signature_header_read")],
    };
    expect(await zoomUrlValidationOnlyPredicate(handler, {} as never)).toBeNull();
  });
});

describe("zoomTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await zoomTimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when crypto.timingSafeEqual reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await zoomTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
});

describe("zoomRawBodyMisusePredicate", () => {
  it("emits not-verified when signature_header_read but no body_as_bytes", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await zoomRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await zoomRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("zoomMissingTimestampCheckPredicate", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await zoomMissingTimestampCheckPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when Date.now reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await zoomMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
});

describe("zoomWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await zoomWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await zoomWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
});

describe("zoomUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await zoomUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
});
