// 08.3 Plan 01 — Zendesk rule pack predicate tests.
// Zendesk uses the timestamp_dot_body signing scheme (closest analog: Slack).
// It is the FIRST provider in the v1 catalog with NO canonical first-party
// webhook SDK — sdk_packages / sdk_verify_calls are both empty arrays.
// missing-signature-verification therefore relies entirely on manual-HMAC
// detection; library-verified is intentionally not shipped.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { zendeskMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { zendeskMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { zendeskRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { zendeskTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { zendeskUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { zendeskWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/zendesk/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "zendeskWebhook",
  provider: "zendesk",
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

const ev = (kind: WebhookEvidence["kind"], provider = "zendesk"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("zendeskMissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no manual HMAC reachable (Zendesk has no SDK)", async () => {
    expect(await zendeskMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac (Node manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(
      await zendeskMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when hmac.new (Python manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(
      await zendeskMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null for non-zendesk provider (contract-violation: predicate must be provider-scoped)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(
      await zendeskMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when inline-middleware sdk_verify_call evidence is present (provider-attributed)", async () => {
    // Adversary-shaped: middleware sets sdk_verify_call evidence with provider='zendesk'.
    // Predicate must trust it (Path B from missing-signature-verification factory).
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(
      await zendeskMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (adversary-shaped attribution)", async () => {
    // Boundary: cross-provider attribution must NOT satisfy zendesk verification.
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "stripe")],
    };
    expect(await zendeskMissingSignatureVerificationPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
});

describe("zendeskTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await zendeskTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await zendeskTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.compare_digest (Python) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("hmac.compare_digest", "hmac")],
    };
    expect(await zendeskTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC is reachable (purity-fail-loudly — predicate must not fire blindly)", async () => {
    expect(await zendeskTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("zendeskRawBodyMisusePredicate", () => {
  it("emits not-verified when verification is attempted but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await zendeskRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await zendeskRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no verification is being attempted (input rejection — only flag attempts)", async () => {
    expect(await zendeskRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("zendeskMissingTimestampCheckPredicate (D-91 non-null timestamp_header branch)", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await zendeskMissingTimestampCheckPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when Date.now reachable alongside manual HMAC (Node)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await zendeskMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when time.time reachable alongside manual HMAC (Python)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("time.time", "time")],
    };
    expect(await zendeskMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await zendeskMissingTimestampCheckPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("zendeskWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await zendeskWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when wrong algorithm (.sha1) reachable — boundary algo", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await zendeskWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await zendeskWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable", async () => {
    expect(await zendeskWrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("zendeskUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await zendeskUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence (no claim of intent)", async () => {
    expect(await zendeskUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});
