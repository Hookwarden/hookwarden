// 08.3 Plan 14 — Calendly webhook rule pack predicate tests.
// Calendly uses the Slack signing recipe (`${timestamp}.${rawBody}`) with the
// Stripe-shaped comma-separated `t=<unix>,v1=<hex>` header. Six baseline
// catalog-parameterized rules + the NEW signature-header-parse-mishandled rule.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { calendlySignatureHeaderParseMishandledPredicate } from "../src/predicates/calendly-header-parse.js";
import { calendlyMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { calendlyMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { calendlyRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { calendlyTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { calendlyUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { calendlyWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/calendly/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "calendlyWebhook",
  provider: "calendly",
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

const ev = (kind: WebhookEvidence["kind"], provider = "calendly"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("calendlyMissingSignatureVerificationPredicate", () => {
  it("emits not-verified when no manual HMAC reachable", async () => {
    expect(await calendlyMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(
      await calendlyMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null for non-calendly provider (contract-violation)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(
      await calendlyMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
});

describe("calendlyTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await calendlyTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await calendlyTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
});

describe("calendlyRawBodyMisusePredicate", () => {
  it("emits not-verified when signature_header_read but no body_as_bytes", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await calendlyRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await calendlyRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("calendlyMissingTimestampCheckPredicate", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await calendlyMissingTimestampCheckPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when Date.now reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await calendlyMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
});

describe("calendlyWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await calendlyWrongHmacAlgorithmPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await calendlyWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
});

describe("calendlyUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await calendlyUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
});

describe("calendlySignatureHeaderParseMishandledPredicate (NEW Plan 14 rule)", () => {
  // The classic Calendly bug: handler reads the comma-separated header value
  // but never parses out t= and v1= — likely compares the full `t=,v1=` value
  // against bare HMAC or hashes the body alone.
  it("emits manual-review when manual HMAC + signature_header_read + no string-parse symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
      evidence: [ev("signature_header_read")],
    };
    expect(
      await calendlySignatureHeaderParseMishandledPredicate(handler, {} as never),
    ).toBe("manual-review");
  });
  it("returns null when String.prototype.split is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("String.prototype.split"),
      ],
      evidence: [ev("signature_header_read")],
    };
    expect(
      await calendlySignatureHeaderParseMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when PHP explode is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("explode")],
      evidence: [ev("signature_header_read")],
    };
    expect(
      await calendlySignatureHeaderParseMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when no manual HMAC reachable (only fires when verifying)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(
      await calendlySignatureHeaderParseMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when no signature_header_read evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(
      await calendlySignatureHeaderParseMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null for non-calendly provider (contract-violation: provider-scoped)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
      evidence: [ev("signature_header_read", "stripe")],
    };
    expect(
      await calendlySignatureHeaderParseMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });
});
