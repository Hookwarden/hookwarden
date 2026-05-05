// 06.3 — Twilio rule pack predicate tests. Custom-dispatch wiring is asserted explicitly:
// CUSTOM_SIGNING_PREDICATES['twilio'] must equal twilioSigningPredicate by module-load time
// (no dynamic import; D-23 engine purity preserved).

import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { twilioSigningPredicate } from "../src/predicates/custom/twilio-signing.js";
import { twilioLibraryVerifiedPredicate } from "../src/predicates/library-verified-recognition.js";
import {
  CUSTOM_SIGNING_PREDICATES,
  twilioMissingSignatureVerificationPredicate,
} from "../src/predicates/missing-signature-verification.js";
import { twilioMissingTimestampCheckPredicate } from "../src/predicates/missing-timestamp-check.js";
import { twilioRawBodyMisusePredicate } from "../src/predicates/raw-body-misuse.js";
import { twilioTimingUnsafeComparisonPredicate } from "../src/predicates/timing-unsafe-comparison.js";
import { twilioUnreachableVerificationPredicate } from "../src/predicates/unreachable-verification.js";
import { twilioWrongHmacAlgorithmPredicate } from "../src/predicates/wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/twilio",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "twilioWebhook",
  provider: "twilio",
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

const ev = (kind: WebhookEvidence["kind"], provider = "twilio"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("twilio custom-dispatch wiring (D-92)", () => {
  it("CUSTOM_SIGNING_PREDICATES['twilio'] equals twilioSigningPredicate by module-load time", () => {
    expect(CUSTOM_SIGNING_PREDICATES["twilio"]).toBe(twilioSigningPredicate);
  });
  it("twilio-missing-signature-verification routes through the custom dispatch (no SDK + no manual HMAC = not-verified)", async () => {
    expect(await twilioMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
});

describe("twilioMissingSignatureVerificationPredicate", () => {
  it("returns null when twilio.validateRequest is reachable from 'twilio' package", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("twilio.validateRequest", "twilio")],
    };
    expect(await twilioMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("emits not-verified when validateRequest matches but import_source is wrong", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("validateRequest", "@some-other/lib")],
    };
    expect(await twilioMissingSignatureVerificationPredicate(handler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when crypto.createHmac is reachable (manual HMAC defers)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await twilioMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
  it("returns null for non-twilio provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await twilioMissingSignatureVerificationPredicate(handler, {} as never)).toBeNull();
  });
});

describe("twilioTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified when manual HMAC reachable and no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await twilioTimingUnsafeComparisonPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when timingSafeEqual reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await twilioTimingUnsafeComparisonPredicate(handler, {} as never)).toBeNull();
  });
});

describe("twilioRawBodyMisusePredicate", () => {
  it("emits not-verified when attempting verification but no body_as_bytes evidence", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read")],
    };
    expect(await twilioRawBodyMisusePredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes_or_buffer evidence present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer", "twilio")],
    };
    expect(await twilioRawBodyMisusePredicate(handler, {} as never)).toBeNull();
  });
});

describe("twilioMissingTimestampCheckPredicate", () => {
  it("emits manual-review when manual HMAC reachable with no timestamp symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await twilioMissingTimestampCheckPredicate(handler, {} as never)).toBe("manual-review");
  });
  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("twilio.validateRequest", "twilio")],
    };
    expect(await twilioMissingTimestampCheckPredicate(handler, {} as never)).toBeNull();
  });
});

describe("twilioWrongHmacAlgorithmPredicate (sha1 expected)", () => {
  it("emits not-verified when wrong algorithm (.sha256) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await twilioWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("not-verified");
  });
  it("returns null when expected algorithm (.sha1) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha1")],
    };
    expect(await twilioWrongHmacAlgorithmPredicate(handler, {} as never)).toBeNull();
  });
  it("WR-01 manual-review when both expected and wrong reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("hash.sha1"),
        sym("hash.sha256"),
      ],
    };
    expect(await twilioWrongHmacAlgorithmPredicate(handler, {} as never)).toBe("manual-review");
  });
});

describe("twilioUnreachableVerificationPredicate", () => {
  it("emits manual-review when sdk_import present but no SDK verify reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await twilioUnreachableVerificationPredicate(handler, {} as never)).toBe(
      "manual-review",
    );
  });
});

describe("twilioLibraryVerifiedPredicate", () => {
  it("emits verified when twilio.validateRequest is reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("twilio.validateRequest", "twilio")],
    };
    expect(await twilioLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
  });
});
