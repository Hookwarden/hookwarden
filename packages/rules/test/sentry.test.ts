// 08.3 Plan 10 — Sentry Integration Platform rule pack predicate tests.
// Sentry uses the raw_body signing scheme with a dedicated `Sentry-Hook-Signature`
// header (no cross-provider attribution risk). Companion `Sentry-Hook-Resource`
// header is for event-type routing, not verification. Modelled on linear.test.ts /
// datadog.test.ts — same raw_body + sha256 + hex shape, same no-canonical-SDK /
// no-timestamp-header story.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { sentryMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { sentryMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { sentryRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { sentryHeaderConfusionPredicate } from "../src/predicates/sentry-header-confusion.js";
import { sentryTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { sentryUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { sentryWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/sentry/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "sentryWebhook",
  provider: "sentry",
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

const ev = (kind: WebhookEvidence["kind"], provider = "sentry"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("sentryMissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no manual HMAC reachable (Sentry has no canonical SDK)", async () => {
    expect(await sentryMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac (Node manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await sentryMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.new (Python manual path — Sentry's documented sample) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await sentryMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-sentry provider (contract-violation: predicate must be provider-scoped)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await sentryMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when inline-middleware sdk_verify_call evidence is present (provider-attributed)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(await sentryMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (adversary-shaped attribution)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "github")],
    };
    expect(await sentryMissingSignatureVerificationPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
});

describe("sentryTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await sentryTimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when crypto.timingSafeEqual reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await sentryTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.compare_digest (Python) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("hmac.compare_digest", "hmac")],
    };
    expect(await sentryTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC is reachable (purity-fail-loudly — predicate must not fire blindly)", async () => {
    expect(await sentryTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("sentryRawBodyMisusePredicate", () => {
  it("emits not-verified when verification is attempted but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await sentryRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await sentryRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no verification is being attempted (input rejection — only flag attempts)", async () => {
    expect(await sentryRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("sentryMissingTimestampCheckPredicate (D-91 null timestamp_header — delivery-ID dedup analog)", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await sentryMissingTimestampCheckPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when Date.now reachable alongside manual HMAC (Node)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await sentryMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await sentryMissingTimestampCheckPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("sentryWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await sentryWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when wrong algorithm (.sha1) reachable — boundary algo", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await sentryWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await sentryWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable", async () => {
    expect(await sentryWrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
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
    expect(await sentryWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("manual-review");
  });
});

describe("sentryUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await sentryUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence (no claim of intent)", async () => {
    expect(await sentryUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("sentryHeaderConfusionPredicate (Plan 10 retrofit — Sentry-Hook-Resource vs Sentry-Hook-Signature)", () => {
  // The bug: handler HMACs manually but reads Sentry-Hook-Resource (the event-type
  // header) instead of Sentry-Hook-Signature. The engine's signature_header_read
  // evidence only fires for headers matching catalog.signature_header — so when the
  // handler is doing manual HMAC AND no signature_header_read evidence is present,
  // it's likely reading the wrong Sentry-Hook-* header.
  it("emits manual-review when manual HMAC reachable but no signature_header_read evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await sentryHeaderConfusionPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when manual HMAC reachable AND signature_header_read evidence present (handler reads the right header)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
      evidence: [ev("signature_header_read")],
    };
    expect(await sentryHeaderConfusionPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly — only fire when HMAC IS attempted)", async () => {
    expect(await sentryHeaderConfusionPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null for non-sentry provider (contract-violation: provider-scoped)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await sentryHeaderConfusionPredicate(handler, {} as never)).toBeNull();
  });
  it("emits manual-review with Python manual HMAC reachable too", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await sentryHeaderConfusionPredicate(handler, {} as never)).toBe("manual-review");
  });
});
