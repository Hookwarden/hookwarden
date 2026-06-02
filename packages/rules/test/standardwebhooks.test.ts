// 08.3 Plan 16 — Standard Webhooks spec predicate tests (library-prong scope).
// signing_input_format: 'custom' — missing-signature-verification dispatches via
// CUSTOM_SIGNING_PREDICATES['standardwebhooks'] at predicates/custom/standardwebhooks-
// signing.ts. The library-verified rule is the load-bearing piece of the multiplier
// claim: any conformant provider (Clerk/Resend/Lob/Mux/Knock/Brex/ChannelTalk/
// Liveblocks/Sumsub) using the `standardwebhooks` library is detected without a
// per-provider catalog entry.
//
// Hand-rolled structural AST detection (Clerk CVE-2025-53548 catch) is deferred to
// Plan 16b — not covered by these tests.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { standardwebhooksSigningPredicate } from "../src/predicates/custom/standardwebhooks-signing.js";
import { standardwebhooksLibraryVerifiedPredicate } from "../src/predicates/library-verified-recognition.js";
import { standardwebhooksMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { standardwebhooksRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { standardwebhooksTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { standardwebhooksUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { standardwebhooksWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "webhookHandler",
  provider: "standardwebhooks",
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

const ev = (kind: WebhookEvidence["kind"], provider = "standardwebhooks"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("standardwebhooksLibraryVerifiedPredicate (multiplier claim)", () => {
  it("emits verified when Webhook.verify reachable from standardwebhooks (npm)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("Webhook.verify", "standardwebhooks")],
    };
    expect(await standardwebhooksLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
  });
  it("emits verified for a Clerk handler using standardwebhooks (no per-provider catalog entry)", async () => {
    // Multiplier proof: handler is assigned to provider 'standardwebhooks' by header
    // detection (Clerk uses svix-style webhook-id / webhook-timestamp / webhook-signature).
    // The library import + verify-call is enough to short-circuit to verified — no
    // 'clerk' provider entry exists in PROVIDER_CATALOG.
    const handler: WebhookHandler = {
      ...baseHandler,
      route_pattern: "/api/webhooks/clerk",
      reachable_symbols: [sym("Webhook.verify", "standardwebhooks")],
    };
    expect(await standardwebhooksLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
  });
  it("emits verified for a Resend handler using standardwebhooks (Python)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      framework: "fastapi",
      file_path: "app/main.py",
      route_pattern: "/api/webhooks/resend",
      reachable_symbols: [sym("Webhook.verify", "standardwebhooks")],
    };
    expect(await standardwebhooksLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
  });
  it("emits verified for a Mux handler using standard-webhooks/php (PHP)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      framework: "laravel",
      file_path: "app/Http/Controllers/MuxWebhookController.php",
      route_pattern: "/webhooks/mux",
      reachable_symbols: [sym("StandardWebhooks\\Webhook::verify", "standard-webhooks/php")],
    };
    expect(await standardwebhooksLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
  });
  it("returns null when no SDK verify reachable", async () => {
    expect(await standardwebhooksLibraryVerifiedPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null for non-standardwebhooks provider (provider-scoped)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      reachable_symbols: [sym("Webhook.verify", "standardwebhooks")],
    };
    expect(await standardwebhooksLibraryVerifiedPredicate(handler, {} as never)).toBeNull();
  });
});

describe("standardwebhooksSigningPredicate (custom-predicate slot for missing-verification)", () => {
  it("emits not-verified with no library reach and no manual HMAC entry", async () => {
    expect(await standardwebhooksSigningPredicate(baseHandler, {} as never)).toBe("not-verified");
  });
  it("returns null when SDK verify reachable (library-prong short-circuit)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("Webhook.verify", "standardwebhooks")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBeNull();
  });
  // 08.3 Plan 16b changed this contract: manual HMAC reachable with ZERO comparison-shaped
  // symbol is now the CVE-2025-53548 hand-rolled catch → not-verified (was null under the
  // library-prong-only Plan 16). Full hand-rolled coverage lives in standardwebhooks-handrolled.test.ts.
  it("emits not-verified when manual HMAC reachable but no comparison reachable (CVE-2025-53548)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when inline-middleware sdk_verify_call evidence is present (Path B)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (adversary-shaped)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "stripe")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null for non-standardwebhooks provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBeNull();
  });
});

describe("standardwebhooksTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await standardwebhooksTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await standardwebhooksTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(
      await standardwebhooksTimingUnsafeComparisonPredicate(baseHandler, {} as never),
    ).toBeNull();
  });
});

describe("standardwebhooksRawBodyMisusePredicate", () => {
  it("emits not-verified when verification attempted but no body_as_bytes_or_buffer", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await standardwebhooksRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes_or_buffer evidence present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await standardwebhooksRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no verification being attempted", async () => {
    expect(await standardwebhooksRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("standardwebhooksMissingTimestampCheckPredicate", () => {
  it("emits manual-review when manual HMAC reachable and no timestamp check", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await standardwebhooksMissingTimestampCheckPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when Date.now reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await standardwebhooksMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("Webhook.verify", "standardwebhooks")],
    };
    expect(await standardwebhooksMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
});

describe("standardwebhooksWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha1) reachable — boundary algo", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await standardwebhooksWrongHmacAlgorithmPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await standardwebhooksWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
});

describe("standardwebhooksUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_import")],
    };
    expect(await standardwebhooksUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence", async () => {
    expect(
      await standardwebhooksUnreachableVerificationPredicate(baseHandler, {} as never),
    ).toBeNull();
  });
});
