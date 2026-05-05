// Direct tests for the 6 catalog-parameterized predicate factories (D-90, D-91, D-93).
// These tests exercise the factories with synthetic catalog entries — independent of the
// Stripe/GitHub regression suite — so failures here point at the parameterization itself,
// not at provider-specific rules.

import type {
  ProviderCatalogEntry,
  ReachableSymbol,
  WebhookEvidence,
  WebhookHandler,
} from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_SIGNING_PREDICATES,
  createMissingSignatureVerificationPredicate,
} from "../../src/predicates/missing-signature-verification.js";
import { createMissingTimestampCheckPredicate } from "../../src/predicates/missing-timestamp-check.js";
import { createRawBodyMisusePredicate } from "../../src/predicates/raw-body-misuse.js";
import { createTimingUnsafeComparisonPredicate } from "../../src/predicates/timing-unsafe-comparison.js";
import { createUnreachableVerificationPredicate } from "../../src/predicates/unreachable-verification.js";
import { createWrongHmacAlgorithmPredicate } from "../../src/predicates/wrong-hmac-algorithm.js";

const FAKE_CATALOG: ProviderCatalogEntry = {
  signature_header: ["x-fake-signature"],
  sdk_packages: ["@fake/sdk"],
  sdk_verify_calls: ["fake.verify"],
  secret_env_prefix: ["FAKE_"],
  secret_literal_prefix: ["fake_"],
  conventional_paths: ["/webhooks/fake"],
  hmac_algorithm: "sha512",
  signing_input_format: "raw_body",
  timestamp_header: "x-fake-timestamp",
  signature_encoding: "hex",
  applicable_rules: ["missing-signature-verification", "wrong-hmac-algorithm"],
};

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/fake",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "handleFake",
  provider: "fakeprov",
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

const ev = (kind: WebhookEvidence["kind"], provider = "fakeprov"): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail: "x",
});

describe("createMissingSignatureVerificationPredicate", () => {
  const pred = createMissingSignatureVerificationPredicate("fakeprov", FAKE_CATALOG);

  it("emits not-verified when no SDK verify and no manual HMAC reachable", async () => {
    expect(await pred(baseHandler, {} as never)).toBe("not-verified");
  });

  it("returns null when SDK verify call reachable AND import_source ∈ sdk_packages", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("fake.verify", "@fake/sdk")],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("emits not-verified when SDK verify name matches but import_source is wrong", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("fake.verify", "@some-other/lib")],
    };
    expect(await pred(handler, {} as never)).toBe("not-verified");
  });

  it("returns null when SDK verify name matches AND import_source is null (engine unresolved)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("fake.verify", null)],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("returns null when handler.provider does not match the bound provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "other" };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("D-92 custom-dispatch: returns null when signing_input_format='custom' and no predicate registered", async () => {
    const customCatalog: ProviderCatalogEntry = { ...FAKE_CATALOG, signing_input_format: "custom" };
    const customPred = createMissingSignatureVerificationPredicate("fakeprov", customCatalog);
    // Ensure registry is empty for "fakeprov"
    delete CUSTOM_SIGNING_PREDICATES["fakeprov"];
    expect(await customPred(baseHandler, {} as never)).toBeNull();
  });

  it("D-92 custom-dispatch: delegates when a custom predicate is registered", async () => {
    const customCatalog: ProviderCatalogEntry = { ...FAKE_CATALOG, signing_input_format: "custom" };
    const customPred = createMissingSignatureVerificationPredicate("fakeprov", customCatalog);
    CUSTOM_SIGNING_PREDICATES["fakeprov"] = async () => "not-verified";
    try {
      expect(await customPred(baseHandler, {} as never)).toBe("not-verified");
    } finally {
      delete CUSTOM_SIGNING_PREDICATES["fakeprov"];
    }
  });
});

describe("createTimingUnsafeComparisonPredicate", () => {
  const pred = createTimingUnsafeComparisonPredicate("fakeprov", FAKE_CATALOG);

  it("emits not-verified when manual HMAC reachable and no constant-time compare", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await pred(handler, {} as never)).toBe("not-verified");
  });

  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("fake.verify", "@fake/sdk")],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("returns null when timingSafeEqual reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("returns null for non-matching provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "other" };
    expect(await pred(handler, {} as never)).toBeNull();
  });
});

describe("createRawBodyMisusePredicate", () => {
  const pred = createRawBodyMisusePredicate("fakeprov", FAKE_CATALOG);

  it("emits not-verified when attempting verification but body_as_bytes_or_buffer absent", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("signature_header_read")] };
    expect(await pred(handler, {} as never)).toBe("not-verified");
  });

  it("returns null when body_as_bytes_or_buffer evidence present", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer", "fakeprov")],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("returns null when handler not attempting verification", async () => {
    expect(await pred(baseHandler, {} as never)).toBeNull();
  });

  it("returns null for non-matching provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "other" };
    expect(await pred(handler, {} as never)).toBeNull();
  });
});

describe("createMissingTimestampCheckPredicate", () => {
  const pred = createMissingTimestampCheckPredicate("fakeprov", FAKE_CATALOG);

  it("emits manual-review when manual HMAC reachable and no timestamp symbol", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await pred(handler, {} as never)).toBe("manual-review");
  });

  it("returns null when timestamp symbol reachable alongside manual HMAC", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("Date.now")],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("fake.verify", "@fake/sdk")],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("returns null for non-matching provider", async () => {
    const handler: WebhookHandler = { ...baseHandler, provider: "other" };
    expect(await pred(handler, {} as never)).toBeNull();
  });
});

describe("createWrongHmacAlgorithmPredicate", () => {
  const pred = createWrongHmacAlgorithmPredicate("fakeprov", FAKE_CATALOG); // sha512 expected

  it("emits not-verified when wrong algorithm symbol (.sha256) reachable for sha512 provider", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await pred(handler, {} as never)).toBe("not-verified");
  });

  it("returns null when expected algorithm (.sha512) reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("WR-01: emits manual-review when BOTH expected and wrong reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("hash.sha512"),
        sym("hash.sha256"),
      ],
    };
    expect(await pred(handler, {} as never)).toBe("manual-review");
  });

  it("emits manual-review when manual HMAC reachable but algorithm undetermined", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await pred(handler, {} as never)).toBe("manual-review");
  });

  it("returns null when no manual HMAC path reachable", async () => {
    expect(await pred(baseHandler, {} as never)).toBeNull();
  });
});

describe("createUnreachableVerificationPredicate", () => {
  const pred = createUnreachableVerificationPredicate("fakeprov", FAKE_CATALOG);

  it("emits manual-review when sdk_import evidence present but SDK verify NOT reachable", async () => {
    const handler: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await pred(handler, {} as never)).toBe("manual-review");
  });

  it("returns null when SDK verify reachable", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_import")],
      reachable_symbols: [sym("fake.verify", "@fake/sdk")],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });

  it("returns null when no sdk_import evidence", async () => {
    expect(await pred(baseHandler, {} as never)).toBeNull();
  });

  it("returns null for non-matching provider", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "other",
      evidence: [ev("sdk_import", "other")],
    };
    expect(await pred(handler, {} as never)).toBeNull();
  });
});
