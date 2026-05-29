// 08.3 Plan 13 — Notion rule pack predicate tests.
// Notion uses a two-phase auth model: initial verification-token echo on setup,
// HMAC-SHA256 signed payloads on every runtime event. signing_input_format: 'custom'
// dispatches to CUSTOM_SIGNING_PREDICATES['notion'] for missing-signature-verification.
// The NEW verification-token-only rule catches handlers that read the signature header
// but never compute HMAC (likely comparing against a stored verification token).

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { notionMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { notionVerificationTokenOnlyPredicate } from "../src/predicates/notion-verification-token-only.js";
import { notionRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { notionTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { notionUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { notionWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";
// Side-effect import to register notion-signing in CUSTOM_SIGNING_PREDICATES.
import "../src/predicates/custom/notion-signing.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/notion/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "notionWebhook",
  provider: "notion",
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

const ev = (kind: WebhookEvidence["kind"], provider = "notion"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("notionMissingSignatureVerificationPredicate (D-92 custom slot dispatch)", () => {
  it("emits not-verified when no HMAC reachable AND no signature_header_read evidence", async () => {
    expect(await notionMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac reachable (custom slot defers)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await notionMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when signature_header_read evidence is present (custom slot defers — other rules grade)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await notionMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-notion provider (contract-violation: provider-scoped)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await notionMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("notionVerificationTokenOnlyPredicate (NEW Plan 13 rule — challenge-vs-signature bifurcation)", () => {
  // The classic Notion bug: handler reads X-Notion-Signature (the header IS being
  // read) but no manual HMAC computation is reachable. Most likely the handler is
  // comparing the signature against a stored verification token, or trusting any
  // well-formed value.
  it("emits manual-review when signature_header_read present BUT no manual HMAC reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await notionVerificationTokenOnlyPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when signature_header_read present AND manual HMAC reachable (handler is verifying)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
      evidence: [ev("signature_header_read")],
    };
    expect(await notionVerificationTokenOnlyPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no signature_header_read evidence (missing-signature-verification grades this)", async () => {
    expect(await notionVerificationTokenOnlyPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null for non-notion provider (contract-violation: provider-scoped)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      evidence: [ev("signature_header_read", "stripe")],
    };
    expect(await notionVerificationTokenOnlyPredicate(handler, {} as never)).toBeNull();
  });
  it("emits manual-review when signature_header_read present + Python hmac.new NOT reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await notionVerificationTokenOnlyPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
});

describe("notionTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await notionTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await notionTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await notionTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("notionRawBodyMisusePredicate", () => {
  it("emits not-verified when signature_header_read but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await notionRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await notionRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("notionWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await notionWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await notionWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable", async () => {
    expect(await notionWrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("notionUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await notionUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence", async () => {
    expect(await notionUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});
