import type { ReachableSymbol, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import {
  createLibraryVerifiedPredicate,
  githubLibraryVerifiedPredicate,
  stripeLibraryVerifiedPredicate,
} from "../../src/predicates/library-verified-recognition.js";

const baseHandler: WebhookHandler = {
  id: "h1",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/stripe",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 10, col: 1, end_line: 12, end_col: 1 },
  handler_function_name: "handleStripe",
  provider: "stripe",
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

describe("library-verified-recognition (RULES-04 D-56)", () => {
  describe("stripeLibraryVerifiedPredicate", () => {
    it("returns 'verified' when stripe.webhooks.constructEvent is reachable", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        reachable_symbols: [sym("stripe.webhooks.constructEvent", "stripe")],
      };
      expect(await stripeLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
    });

    it("returns 'verified' for Python form stripe.Webhook.construct_event", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        reachable_symbols: [sym("stripe.Webhook.construct_event", "stripe")],
      };
      expect(await stripeLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
    });

    it("returns null when no SDK verify call is reachable (defer to other rules)", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
      };
      expect(await stripeLibraryVerifiedPredicate(handler, {} as never)).toBeNull();
    });

    it("returns null for non-stripe provider (rule does not apply)", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        provider: "github",
        reachable_symbols: [sym("stripe.webhooks.constructEvent", "stripe")],
      };
      expect(await stripeLibraryVerifiedPredicate(handler, {} as never)).toBeNull();
    });
  });

  describe("githubLibraryVerifiedPredicate", () => {
    it("returns 'verified' when @octokit/webhooks 'verify' is reachable", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        provider: "github",
        reachable_symbols: [sym("webhooks.verify", "@octokit/webhooks")],
      };
      expect(await githubLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
    });

    it("returns null for non-github handler", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        provider: "stripe",
        reachable_symbols: [sym("webhooks.verify", "@octokit/webhooks")],
      };
      expect(await githubLibraryVerifiedPredicate(handler, {} as never)).toBeNull();
    });
  });

  describe("createLibraryVerifiedPredicate factory", () => {
    it("returns null when sdkVerifyCalls is empty (no list to match)", async () => {
      const predicate = createLibraryVerifiedPredicate("stripe", []);
      const handler: WebhookHandler = {
        ...baseHandler,
        reachable_symbols: [sym("stripe.webhooks.constructEvent", "stripe")],
      };
      expect(await predicate(handler, {} as never)).toBeNull();
    });

    it("matches exact qualified_name (no .endsWith required)", async () => {
      const predicate = createLibraryVerifiedPredicate("stripe", ["myCustomVerify"]);
      const handler: WebhookHandler = {
        ...baseHandler,
        reachable_symbols: [sym("myCustomVerify", "custom-pkg")],
      };
      expect(await predicate(handler, {} as never)).toBe("verified");
    });
  });

  // Phase 8.1 Plan 08 — PHP path via handler.evidence (sdk_verify_call evidence kind).
  describe("PHP evidence-based path (Phase 8.1)", () => {
    it("returns 'verified' for stripe handler with sdk_verify_call evidence", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        framework: "laravel",
        // No reachable_symbols (PHP reach is bounded in v1).
        reachable_symbols: [],
        evidence: [
          {
            kind: "sdk_verify_call",
            provider: "stripe",
            location: { line: 1, col: 1, end_line: 1, end_col: 1 },
            detail: "Stripe\\Webhook::constructEvent",
          },
        ],
      };
      expect(await stripeLibraryVerifiedPredicate(handler, {} as never)).toBe("verified");
    });

    it("returns null when sdk_verify_call evidence is for a different provider", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        framework: "laravel",
        reachable_symbols: [],
        evidence: [
          {
            kind: "sdk_verify_call",
            provider: "shopify",
            location: { line: 1, col: 1, end_line: 1, end_col: 1 },
            detail: "Shopify\\Utils::validateHmac",
          },
        ],
      };
      expect(await stripeLibraryVerifiedPredicate(handler, {} as never)).toBeNull();
    });

    it("returns null when handler.evidence has no sdk_verify_call entries", async () => {
      const handler: WebhookHandler = {
        ...baseHandler,
        framework: "laravel",
        reachable_symbols: [],
        evidence: [
          {
            kind: "signature_header_read",
            provider: "stripe",
            location: { line: 1, col: 1, end_line: 1, end_col: 1 },
            detail: "stripe-signature",
          },
        ],
      };
      expect(await stripeLibraryVerifiedPredicate(handler, {} as never)).toBeNull();
    });
  });
});
