// 08.3 Plan 06 — Auth0 Log Streams rule pack predicate tests.
// Auth0 uses the raw_body signing scheme (closest analog: Shopify / DocuSign)
// with a dedicated `Auth0-Signature` header per pinned defaults — see
// 08.3-06-SUMMARY.md `## Field decisions` for doc-verification status.
//
// Test budget per Phase 6 D-09: ~22 tests across the 6 predicates with the
// 5-positive / 8-negative / 3-manual-review / 6-SOC2-evidence-bearing split.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { auth0MissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { auth0MissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { auth0RawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { auth0TimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { auth0UnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { auth0WrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/auth0/log-streams",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "auth0LogStreamWebhook",
  provider: "auth0",
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

const ev = (kind: WebhookEvidence["kind"], provider = "auth0"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("auth0MissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no manual HMAC reachable", async () => {
    expect(await auth0MissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac (Node manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await auth0MissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.new (Python manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await auth0MissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-auth0 provider (contract-violation guard)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await auth0MissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when inline-middleware sdk_verify_call evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(await auth0MissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "stripe")],
    };
    expect(await auth0MissingSignatureVerificationPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
});

describe("auth0TimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await auth0TimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when crypto.timingSafeEqual reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await auth0TimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.compare_digest (Python) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("hmac.compare_digest", "hmac")],
    };
    expect(await auth0TimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC is reachable (purity-fail-loudly)", async () => {
    expect(await auth0TimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("auth0RawBodyMisusePredicate", () => {
  it("emits not-verified when verification is attempted but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await auth0RawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await auth0RawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no verification is being attempted", async () => {
    expect(await auth0RawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("auth0MissingTimestampCheckPredicate (D-91 null timestamp_header — log-event-ID dedup analog)", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await auth0MissingTimestampCheckPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when Date.now reachable alongside manual HMAC (Node)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await auth0MissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await auth0MissingTimestampCheckPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("auth0WrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await auth0WrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when wrong algorithm (.sha1) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await auth0WrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await auth0WrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable", async () => {
    expect(await auth0WrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
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
    expect(await auth0WrongHmacAlgorithmPredicate(handler, {} as never)).toBe("manual-review");
  });
});

describe("auth0UnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await auth0UnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence (no claim of intent)", async () => {
    expect(await auth0UnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});
