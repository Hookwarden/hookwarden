// 08.3 Plan 08 — Postmark rule pack predicate tests.
// Postmark's authentication model is HTTP Basic Auth + IP allowlist (NOT HMAC).
// First v1 provider with this auth shape.
//
// Architectural split tested here:
//   - postmarkSigningPredicate (custom slot): emits not-verified ONLY when
//     NEITHER Basic Auth nor IP allowlist is reachable.
//   - postmarkMissingBasicAuthPredicate: manual-review when IP reachable but
//     Basic Auth not (partial coverage).
//   - postmarkMissingIpAllowlistPredicate: manual-review when Basic Auth
//     reachable but IP not (partial coverage).
//   - Fully covered (both layers reachable): all 3 return null.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { postmarkMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { postmarkRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { postmarkTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { postmarkUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import {
  postmarkMissingBasicAuthPredicate,
  postmarkMissingIpAllowlistPredicate,
} from "../src/predicates/postmark-basic-auth.js";
import { postmarkSigningPredicate } from "../src/predicates/custom/postmark-signing.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/postmark",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "postmarkWebhook",
  provider: "postmark",
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

const ev = (kind: WebhookEvidence["kind"], provider = "postmark"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

// Reachable symbol shorthand for the two auth layers.
const BASIC_READ = sym("req.headers.authorization");
const IP_READ = sym("req.ip");

describe("postmarkSigningPredicate (D-92 custom-signing dispatch — completely-open detection)", () => {
  it("emits not-verified when NEITHER Basic Auth nor IP allowlist reachable (completely open)", async () => {
    expect(await postmarkSigningPredicate(baseHandler, {} as never)).toBe("not-verified");
  });
  it("returns null when Basic Auth header read is reachable (defers to dedicated rule)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [BASIC_READ],
    };
    expect(await postmarkSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when IP read is reachable (defers to dedicated rule)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [IP_READ],
    };
    expect(await postmarkSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when BOTH layers reachable (fully covered)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [BASIC_READ, IP_READ],
    };
    expect(await postmarkSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-postmark provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await postmarkSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when inline-middleware sdk_verify_call evidence with provider=postmark", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(await postmarkSigningPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (attribution boundary)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "stripe")],
    };
    expect(await postmarkSigningPredicate(handler, {} as never)).toBe("not-verified");
  });
});

describe("postmarkMissingBasicAuthPredicate (IP only → manual-review)", () => {
  it("emits manual-review when IP reachable but Basic Auth not", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [IP_READ],
    };
    expect(await postmarkMissingBasicAuthPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when BOTH layers reachable (fully covered — no partial-coverage finding)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [BASIC_READ, IP_READ],
    };
    expect(await postmarkMissingBasicAuthPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when NEITHER layer reachable (defers to custom slot's not-verified)", async () => {
    expect(await postmarkMissingBasicAuthPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null when Basic Auth reachable (no IP partial-coverage from this rule)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [BASIC_READ],
    };
    expect(await postmarkMissingBasicAuthPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-postmark provider", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      reachable_symbols: [IP_READ],
    };
    expect(await postmarkMissingBasicAuthPredicate(handler, {} as never)).toBeNull();
  });
});

describe("postmarkMissingIpAllowlistPredicate (Basic Auth only → manual-review)", () => {
  it("emits manual-review when Basic Auth reachable but IP not", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [BASIC_READ],
    };
    expect(await postmarkMissingIpAllowlistPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when BOTH layers reachable (fully covered)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [BASIC_READ, IP_READ],
    };
    expect(await postmarkMissingIpAllowlistPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when NEITHER layer reachable", async () => {
    expect(await postmarkMissingIpAllowlistPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null when only IP reachable (no Basic-Auth partial-coverage from this rule)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [IP_READ],
    };
    expect(await postmarkMissingIpAllowlistPredicate(handler, {} as never)).toBeNull();
  });
});

describe("postmarkMissingSignatureVerificationPredicate (factory wrapper — dispatches to custom slot)", () => {
  it("dispatches: emits not-verified on bare handler", async () => {
    expect(await postmarkMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null for non-postmark provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await postmarkMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("postmarkTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    // The factory predicate fires when manual HMAC is reachable; for Postmark
    // this models the Basic-Auth-credential comparison path (rare, but possible
    // when handlers hash credentials before comparison).
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await postmarkTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await postmarkTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await postmarkTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("postmarkRawBodyMisusePredicate", () => {
  it("emits not-verified when signature_header read but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await postmarkRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await postmarkRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("postmarkUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await postmarkUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence", async () => {
    expect(await postmarkUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});
