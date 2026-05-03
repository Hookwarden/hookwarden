import type { ReachableSymbol, WebhookEvidence, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { githubMissingSignatureVerificationPredicate } from "../../src/predicates/github-missing-signature-verification.js";
import { githubMissingTimestampCheckPredicate } from "../../src/predicates/github-missing-timestamp-check.js";
import { githubRawBodyMisusePredicate } from "../../src/predicates/github-raw-body-misuse.js";
import { githubUnreachableVerificationPredicate } from "../../src/predicates/github-unreachable-verification.js";
import { githubWrongHmacAlgorithmPredicate } from "../../src/predicates/github-wrong-hmac-algorithm.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/github",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "handleGithub",
  provider: "github",
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

const ev = (
  kind: WebhookEvidence["kind"],
  provider = "github",
  detail = "x",
): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail,
});

describe("githubMissingSignatureVerificationPredicate (RULES-02 #1)", () => {
  it("emits not-verified when neither SDK verify nor manual HMAC is reachable", async () => {
    expect(await githubMissingSignatureVerificationPredicate(baseHandler, {} as never)).toBe(
      "not-verified",
    );
  });
  it("returns null when @octokit/webhooks 'verify' is reachable", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("webhooks.verify", "@octokit/webhooks")],
    };
    expect(await githubMissingSignatureVerificationPredicate(h, {} as never)).toBeNull();
  });
  it("returns null when @octokit/webhooks-methods 'verifyRequest' is reachable", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("webhooks.verifyRequest", "@octokit/webhooks-methods")],
    };
    expect(await githubMissingSignatureVerificationPredicate(h, {} as never)).toBeNull();
  });
  it("does NOT count generic 'verify' from another package as SDK verify", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("auth.verify", "some-other-pkg")],
    };
    expect(await githubMissingSignatureVerificationPredicate(h, {} as never)).toBe("not-verified");
  });
  it("returns null when crypto.createHmac is reachable (manual path defers)", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await githubMissingSignatureVerificationPredicate(h, {} as never)).toBeNull();
  });
  it("returns null when Python hmac.new is reachable (manual path defers)", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await githubMissingSignatureVerificationPredicate(h, {} as never)).toBeNull();
  });
  it("returns null for non-github provider", async () => {
    const h: WebhookHandler = { ...baseHandler, provider: "stripe" };
    expect(await githubMissingSignatureVerificationPredicate(h, {} as never)).toBeNull();
  });
});

describe("githubRawBodyMisusePredicate (RULES-02 #3)", () => {
  it("emits not-verified when reading github signature header but no raw body", async () => {
    const h: WebhookHandler = { ...baseHandler, evidence: [ev("signature_header_read")] };
    expect(await githubRawBodyMisusePredicate(h, {} as never)).toBe("not-verified");
  });
  it("emits not-verified when SDK verify call evidence exists but no raw body", async () => {
    const h: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_verify_call")] };
    expect(await githubRawBodyMisusePredicate(h, {} as never)).toBe("not-verified");
  });
  it("returns null when body_as_bytes_or_buffer evidence is present", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read"), ev("body_as_bytes_or_buffer")],
    };
    expect(await githubRawBodyMisusePredicate(h, {} as never)).toBeNull();
  });
  it("returns null when handler is not attempting verification", async () => {
    expect(await githubRawBodyMisusePredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null when signature_header_read evidence is for a different provider", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("signature_header_read", "stripe")],
    };
    expect(await githubRawBodyMisusePredicate(h, {} as never)).toBeNull();
  });
  it("returns null for non-github provider", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      evidence: [ev("signature_header_read", "stripe")],
    };
    expect(await githubRawBodyMisusePredicate(h, {} as never)).toBeNull();
  });
});

describe("githubMissingTimestampCheckPredicate (RULES-02 #4)", () => {
  it("emits manual-review for manual HMAC + no persistence-adjacent symbol", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await githubMissingTimestampCheckPredicate(h, {} as never)).toBe("manual-review");
  });
  it("returns null when SDK verify reachable", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("webhooks.verify", "@octokit/webhooks")],
    };
    expect(await githubMissingTimestampCheckPredicate(h, {} as never)).toBeNull();
  });
  it("returns null when persistence-hint symbol reachable (Map)", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac"), sym("Map.prototype.has")],
    };
    expect(await githubMissingTimestampCheckPredicate(h, {} as never)).toBeNull();
  });
  it("returns null when persistence-hint symbol reachable (redis)", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac"), sym("redis.client.set", "ioredis")],
    };
    expect(await githubMissingTimestampCheckPredicate(h, {} as never)).toBeNull();
  });
  it("returns null when no manual HMAC path is reachable", async () => {
    expect(await githubMissingTimestampCheckPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("emits manual-review for Python hmac.new without persistence", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("hmac.new", "hmac")],
    };
    expect(await githubMissingTimestampCheckPredicate(h, {} as never)).toBe("manual-review");
  });
  it("returns null for non-github provider", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      reachable_symbols: [sym("crypto.createHmac")],
    };
    expect(await githubMissingTimestampCheckPredicate(h, {} as never)).toBeNull();
  });
});

describe("githubWrongHmacAlgorithmPredicate (RULES-02 #5)", () => {
  it("emits not-verified for .md5 algorithm symbol with manual HMAC", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.md5")],
    };
    expect(await githubWrongHmacAlgorithmPredicate(h, {} as never)).toBe("not-verified");
  });
  it("emits not-verified for .sha512 algorithm symbol with manual HMAC", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha512")],
    };
    expect(await githubWrongHmacAlgorithmPredicate(h, {} as never)).toBe("not-verified");
  });
  it("returns null when .sha256 is reachable", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("hash.sha256")],
    };
    expect(await githubWrongHmacAlgorithmPredicate(h, {} as never)).toBeNull();
  });
  it("emits manual-review for manual HMAC with undetermined algorithm", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await githubWrongHmacAlgorithmPredicate(h, {} as never)).toBe("manual-review");
  });
  it("returns null when no manual HMAC entry is reachable", async () => {
    expect(await githubWrongHmacAlgorithmPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null for non-github provider", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      reachable_symbols: [sym("crypto.createHmac"), sym("hash.md5")],
    };
    expect(await githubWrongHmacAlgorithmPredicate(h, {} as never)).toBeNull();
  });
});

describe("githubUnreachableVerificationPredicate (RULES-02 #7)", () => {
  it("emits manual-review when @octokit/webhooks imported but verify is not reachable", async () => {
    const h: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import")] };
    expect(await githubUnreachableVerificationPredicate(h, {} as never)).toBe("manual-review");
  });
  it("returns null when verify IS reachable", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      evidence: [ev("sdk_import")],
      reachable_symbols: [sym("webhooks.verify", "@octokit/webhooks")],
    };
    expect(await githubUnreachableVerificationPredicate(h, {} as never)).toBeNull();
  });
  it("returns null when github SDK is not imported", async () => {
    expect(await githubUnreachableVerificationPredicate(baseHandler, {} as never)).toBeNull();
  });
  it("returns null when sdk_import evidence is for a different provider", async () => {
    const h: WebhookHandler = { ...baseHandler, evidence: [ev("sdk_import", "stripe")] };
    expect(await githubUnreachableVerificationPredicate(h, {} as never)).toBeNull();
  });
  it("returns null for non-github provider", async () => {
    const h: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      evidence: [ev("sdk_import", "stripe")],
    };
    expect(await githubUnreachableVerificationPredicate(h, {} as never)).toBeNull();
  });
});
