// 06.4 — Slack rule pack predicate tests. Slack is the FIRST provider in the v1 catalog
// where catalog.timestamp_header is non-null ('x-slack-request-timestamp'); the
// missing-timestamp-check factory's non-null branch is exercised explicitly here.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { slackLibraryVerifiedPredicate } from "../src/predicates/library-verified-recognition.js";
import { slackMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { slackMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { slackRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { slackTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { slackUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { slackWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/slack/events",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "slackEvents",
  provider: "slack",
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

const ev = (kind: WebhookEvidence["kind"], provider = "slack"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("slackMissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no SDK or manual HMAC", async () => {
    expect(await slackMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when verifyRequestSignature reachable from @slack/events-api", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("verifyRequestSignature", "@slack/events-api")],
    };
    expect(await slackMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when isValidSlackRequest reachable from @slack/bolt", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("isValidSlackRequest", "@slack/bolt")],
    };
    expect(await slackMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-slack provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await slackMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("slackTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await slackTimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when timingSafeEqual reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await slackTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
});

describe("slackRawBodyMisusePredicate", () => {
  it("emits not-verified when attempting verification but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("signature_header_read")] };
    expect(await slackRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
});

describe("slackMissingTimestampCheckPredicate (D-91 non-null timestamp_header branch)", () => {
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await slackMissingTimestampCheckPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when Date.now reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await slackMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("verifyRequestSignature", "@slack/events-api")],
    };
    expect(await slackMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
});

describe("slackWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await slackWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await slackWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
});

describe("slackUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await slackUnreachableVerificationPredicate(handler, {} as never)).toBe("manual-review");
  });
});

describe("slackLibraryVerifiedPredicate", () => {
  it("emits verified when verifyRequestSignature is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("verifyRequestSignature", "@slack/events-api")],
    };
    expect(await slackLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
  });
});
