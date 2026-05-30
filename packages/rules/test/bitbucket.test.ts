// 08.3 Plan 12 — Bitbucket Cloud rule pack predicate tests.
// Bitbucket Cloud uses the raw_body signing scheme with `X-Hub-Signature` — the
// THIRD provider (after github + intercom) sharing this header name. The three-way
// disambiguation block at the bottom guards the provider-scope contract.
//
// NEW Plan 12 rule: signature-prefix-not-stripped. Bitbucket Cloud's header value
// is `sha256=<hex>` (like GitHub legacy). Handlers comparing the full value against
// bare HMAC hex silently fail every delivery.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { bitbucketSignaturePrefixNotStrippedPredicate } from "../src/predicates/bitbucket-signature-prefix.js";
import {
  bitbucketMissingSignatureVerificationPredicate,
  githubMissingSignatureVerificationPredicate,
  intercomMissingSignatureVerificationPredicate,
} from "../src/predicates/missing-signature-verification.js";
import { bitbucketMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { bitbucketRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { bitbucketTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { bitbucketUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { bitbucketWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/bitbucket/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "bitbucketWebhook",
  provider: "bitbucket",
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

const ev = (kind: WebhookEvidence["kind"], provider = "bitbucket"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("bitbucketMissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no manual HMAC reachable", async () => {
    expect(await bitbucketMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await bitbucketMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.new (Python) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await bitbucketMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-bitbucket provider (contract-violation)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await bitbucketMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("bitbucketTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await bitbucketTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await bitbucketTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await bitbucketTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("bitbucketRawBodyMisusePredicate", () => {
  it("emits not-verified when verification is attempted but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await bitbucketRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await bitbucketRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("bitbucketMissingTimestampCheckPredicate (D-91 null timestamp_header)", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await bitbucketMissingTimestampCheckPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when Date.now reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await bitbucketMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
});

describe("bitbucketWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await bitbucketWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await bitbucketWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
});

describe("bitbucketUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await bitbucketUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence", async () => {
    expect(await bitbucketUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("bitbucketSignaturePrefixNotStrippedPredicate (NEW Plan 12 rule)", () => {
  // Bitbucket Cloud's X-Hub-Signature value is `sha256=<hex>`. The classic bug:
  // handler reads the full header and compares it against bare HMAC hex without
  // stripping the `sha256=` prefix. Every delivery silently fails.
  it("emits manual-review when manual HMAC + signature_header_read + no string-manipulation symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
      evidence: [ev("signature_header_read")],
    };
    expect(await bitbucketSignaturePrefixNotStrippedPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when String.prototype.replace is reachable (prefix stripped)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("String.prototype.replace")],
      evidence: [ev("signature_header_read")],
    };
    expect(await bitbucketSignaturePrefixNotStrippedPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when String.prototype.split is reachable (alternative parse path)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("String.prototype.split")],
      evidence: [ev("signature_header_read")],
    };
    expect(await bitbucketSignaturePrefixNotStrippedPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when String.prototype.substring is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("String.prototype.substring"),
      ],
      evidence: [ev("signature_header_read")],
    };
    expect(await bitbucketSignaturePrefixNotStrippedPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when PHP substr is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("substr")],
      evidence: [ev("signature_header_read")],
    };
    expect(await bitbucketSignaturePrefixNotStrippedPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (only fires when verification IS attempted)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await bitbucketSignaturePrefixNotStrippedPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no signature_header_read evidence (can't say comparison side is the bug)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await bitbucketSignaturePrefixNotStrippedPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-bitbucket provider (contract-violation: provider-scoped)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "github",
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
      evidence: [ev("signature_header_read", "github")],
    };
    expect(await bitbucketSignaturePrefixNotStrippedPredicate(handler, {} as never)).toBeNull();
  });
});

describe("3-way X-Hub-Signature disambiguation (github / intercom / bitbucket)", () => {
  // X-Hub-Signature is shared across three providers in v1. Each catalog-parameterized
  // predicate must scope to its own handler.provider — adversary-shaped cross-provider
  // attribution must not surface.
  it("bitbucket handler does NOT trip github predicate", async () => {
    expect(await githubMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("bitbucket handler does NOT trip intercom predicate", async () => {
    expect(
      await intercomMissingSignatureVerificationPredicate(baseHandler, {} as never),
    ).toBeNull();
  });
  it("github handler does NOT trip bitbucket predicate", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "github" };
    expect(await bitbucketMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("intercom handler does NOT trip bitbucket predicate", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "intercom" };
    expect(await bitbucketMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});
