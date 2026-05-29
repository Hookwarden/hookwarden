// 08.3 Plan 03 — Intercom rule pack predicate tests.
// Intercom uses the raw_body signing scheme (closest analog: GitHub) and
// literally re-uses GitHub's X-Hub-Signature header. The predicate factory
// pattern is provider-agnostic, so the disambiguation tests at the bottom of
// this file are the load-bearing coverage: each predicate must scope to
// handler.provider === 'intercom' and NOT misfire on GitHub-attributed
// handlers, and vice versa.
//
// Test budget per Phase 6 D-09: ~22 tests across the 6 predicates with the
// 5-positive / 8-negative / 3-manual-review / 6-SOC2-evidence-bearing split
// established in feedback_negative_tests_required.

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { intercomMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { intercomMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { intercomRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { intercomTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { intercomUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { intercomWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";
import { githubMissingSignatureVerificationPredicate } from "../src/predicates/missing-signature-verification.js";
import { githubWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/intercom/webhook",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "intercomWebhook",
  provider: "intercom",
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

const ev = (kind: WebhookEvidence["kind"], provider = "intercom"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("intercomMissingSignatureVerificationPredicate", () => {
  it("emits not-verified with no manual HMAC reachable (Intercom has no canonical SDK)", async () => {
    expect(await intercomMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac (Node manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(
      await intercomMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when hmac.new (Python manual path) is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(
      await intercomMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null for non-intercom provider (contract-violation: predicate must be provider-scoped)", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(
      await intercomMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("returns null when inline-middleware sdk_verify_call evidence is present (provider-attributed)", async () => {
    // Adversary-shaped: middleware sets sdk_verify_call evidence with provider='intercom'.
    // Predicate must trust it (Path B from missing-signature-verification factory).
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call")],
    };
    expect(
      await intercomMissingSignatureVerificationPredicate(handler, {} as never),
    ).toBeNull();
  });
  it("emits not-verified when sdk_verify_call evidence has wrong provider (adversary-shaped attribution)", async () => {
    // Boundary: cross-provider attribution must NOT satisfy intercom verification.
    // Critical because Intercom shares X-Hub-Signature with GitHub — sdk_verify_call
    // with provider='github' cannot vouch for Intercom verification.
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_verify_call", "github")],
    };
    expect(await intercomMissingSignatureVerificationPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
});

describe("intercomTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable but no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await intercomTimingUnsafeComparisonPredicate(handler, {} as never)).toBe(
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
    expect(await intercomTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when hmac.compare_digest (Python) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("hmac.compare_digest", "hmac")],
    };
    expect(await intercomTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC is reachable (purity-fail-loudly — predicate must not fire blindly)", async () => {
    expect(await intercomTimingUnsafeComparisonPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("intercomRawBodyMisusePredicate", () => {
  it("emits not-verified when verification is attempted but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await intercomRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes evidence is present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await intercomRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no verification is being attempted (input rejection — only flag attempts)", async () => {
    expect(await intercomRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("intercomMissingTimestampCheckPredicate (D-91 null timestamp_header branch — GitHub analog)", () => {
  // Intercom's timestamp_header is null (no dedicated request header).
  // The factory still fires manual-review when manual HMAC is reachable and
  // no timestamp/dedup symbol is reachable; the message in the YAML steers
  // the user toward delivery-ID dedup rather than a tolerance window.
  it("emits manual-review when manual HMAC reachable and no Date.now/time.time symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await intercomMissingTimestampCheckPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when Date.now reachable alongside manual HMAC (Node)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await intercomMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable (purity-fail-loudly)", async () => {
    expect(await intercomMissingTimestampCheckPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("intercomWrongHmacAlgorithmPredicate", () => {
  it("emits not-verified when wrong algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await intercomWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when wrong algorithm (.sha1) reachable — legacy Intercom boundary algo", async () => {
    // Legacy Intercom shipped sha1; modern Intercom infrastructure signs with sha256.
    // A 2026 codebase still computing sha1 will never match current deliveries —
    // this is the high-severity case the YAML calls out.
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await intercomWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await intercomWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC reachable", async () => {
    expect(await intercomWrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("WR-01: emits manual-review when BOTH sha256 and sha1 reachable (ambiguous attribution)", async () => {
    // WR-01 from wrong-hmac-algorithm.ts: when both expected AND wrong algorithm symbols
    // are reachable, the predicate cannot statically tell which feeds the HMAC — could be
    // legacy fallback path, could be an unrelated ETag. Surface for manual review.
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("hash.sha256"),
        sym("hash.sha1"),
      ],
    };
    expect(await intercomWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("emits not-verified on Python hmac.new + hashlib.sha1 (legacy Intercom language coverage)", async () => {
    // Cross-language coverage: same legacy-sha1 failure mode on the Python side.
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac"), sym("hashlib.sha1", "hashlib")],
    };
    expect(await intercomWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
});

describe("intercomUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await intercomUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
  it("returns null when no sdk_import evidence (no claim of intent)", async () => {
    expect(await intercomUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
});

describe("Intercom ↔ GitHub disambiguation (shared X-Hub-Signature header)", () => {
  // Intercom literally re-uses GitHub's X-Hub-Signature header. Provider
  // attribution in the engine must be carried into the predicate via
  // handler.provider, not inferred from the header alone. These two tests
  // guard against the failure mode where adding Intercom causes GitHub
  // handlers to surface as Intercom findings (and vice versa) — exactly the
  // T-08.3-03-02 threat model entry.
  it("an Intercom-attributed handler does NOT surface as a GitHub finding", async () => {
    // Handler is attributed to intercom — github predicate must short-circuit at
    // the provider check and return null, even though every other signal
    // (manual HMAC reachable, X-Hub-Signature shape) matches the github rule.
    const handler: WebhookHandler = { ...baseHandler, provider: "intercom" };
    expect(await githubMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("a GitHub-attributed handler does NOT surface as an Intercom finding", async () => {
    // Symmetric assertion. Provider attribution upstream wins; Intercom
    // predicate must defer on github handlers.
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "github",
      route_pattern: "/github/webhook",
      handler_function_name: "githubWebhook",
    };
    expect(await intercomMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("wrong-hmac-algorithm respects provider scope (legacy sha1 on GitHub is GitHub's bug, not Intercom's)", async () => {
    // Adversary-shaped: a github handler with sha1 reachable. The intercom
    // wrong-hmac predicate must NOT fire (provider scope), and the github
    // wrong-hmac predicate fires for its own provider.
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "github",
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await intercomWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
    expect(await githubWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
});
