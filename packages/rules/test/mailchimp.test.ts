// 08.3 Plan 07 — Mailchimp rule pack predicate tests.
// Mailchimp's default authentication model is URL-secret-in-path
// (the secret is delivered as a route segment, not a header). The rule
// pack introduces a NEW rule kind (url-secret-in-path) plus the standard
// missing-sig / timing / raw-body / unreachable factory rules.
//
// signing_input_format: 'custom' dispatches through
// CUSTOM_SIGNING_PREDICATES['mailchimp'] at predicates/custom/mailchimp-url-secret.ts.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { mailchimpMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { mailchimpRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { mailchimpTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { mailchimpUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import {
  hasUrlSecretInPath,
  mailchimpUrlSecretInPathPredicate,
} from "../src/predicates/mailchimp-url-secret-in-path.js";
import { mailchimpSigningPredicate } from "../src/predicates/custom/mailchimp-url-secret.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/mailchimp",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "mailchimpWebhook",
  provider: "mailchimp",
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

const ev = (kind: WebhookEvidence["kind"], provider = "mailchimp"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("hasUrlSecretInPath (pattern fragment matcher)", () => {
  it("matches Express :secret pattern", () => {
    expect(hasUrlSecretInPath("/webhooks/mailchimp/:secret")).toBe(true);
  });
  it("matches Express :token pattern", () => {
    expect(hasUrlSecretInPath("/mc-webhook/:token")).toBe(true);
  });
  it("matches FastAPI {secret} pattern", () => {
    expect(hasUrlSecretInPath("/webhooks/mailchimp/{secret}")).toBe(true);
  });
  it("matches generic <token> placeholder", () => {
    expect(hasUrlSecretInPath("/webhooks/mailchimp/<token>")).toBe(true);
  });
  it("does NOT match generic :id parameter (resource identifier, not secret)", () => {
    expect(hasUrlSecretInPath("/webhooks/mailchimp/:id")).toBe(false);
  });
  it("does NOT match generic :slug parameter", () => {
    expect(hasUrlSecretInPath("/webhooks/mailchimp/:slug")).toBe(false);
  });
  it("returns false when no path parameter at all", () => {
    expect(hasUrlSecretInPath("/webhooks/mailchimp")).toBe(false);
  });
  it("is case-insensitive on the param name", () => {
    expect(hasUrlSecretInPath("/webhooks/mailchimp/:Secret")).toBe(true);
    expect(hasUrlSecretInPath("/webhooks/mailchimp/:TOKEN")).toBe(true);
  });
});

describe("mailchimpUrlSecretInPathPredicate (NEW rule kind — surfaces manual-review)", () => {
  it("emits manual-review when route_pattern includes :secret", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      route_pattern: "/webhooks/mailchimp/:secret",
    };
    expect(await mailchimpUrlSecretInPathPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("emits manual-review when route_pattern includes {token}", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      route_pattern: "/mc-webhook/{token}",
    };
    expect(await mailchimpUrlSecretInPathPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when route_pattern has no secret-shaped param", async () => {
    expect(await mailchimpUrlSecretInPathPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null for non-mailchimp provider (contract-violation guard)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      route_pattern: "/webhooks/stripe/:secret",
    };
    expect(await mailchimpUrlSecretInPathPredicate(handler, {} as never)).toBeNull();
  });
});

describe("mailchimpSigningPredicate (D-92 custom-signing dispatch)", () => {
  it("emits not-verified when no URL-secret AND no manual HMAC AND no SDK verify", async () => {
    // Completely open handler — no authentication signal at all.
    expect(await mailchimpSigningPredicate(baseHandler, {} as never)).toBe("not-verified");
  });
  it("returns null when route_pattern includes :secret (defers to url-secret-in-path rule)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      route_pattern: "/webhooks/mailchimp/:secret",
    };
    expect(await mailchimpSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when manual HMAC entry is reachable (modern HMAC option)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await mailchimpSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-mailchimp provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await mailchimpSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when inline-middleware sdk_verify_call evidence with provider=mailchimp", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(await mailchimpSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (attribution boundary)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "stripe")],
    };
    expect(await mailchimpSigningPredicate(handler, {} as never)).toBe("not-verified");
  });
});

describe("mailchimpMissingSignatureVerificationPredicate (factory wrapper — dispatches to custom slot)", () => {
  it("dispatches: emits not-verified on bare handler", async () => {
    expect(await mailchimpMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null for non-mailchimp provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await mailchimpMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("mailchimpTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await mailchimpTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await mailchimpTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await mailchimpTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("mailchimpRawBodyMisusePredicate (modern HMAC option only)", () => {
  it("emits not-verified when signature_header read but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await mailchimpRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await mailchimpRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("mailchimpUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await mailchimpUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence", async () => {
    expect(await mailchimpUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});
