import type { ResolvedMiddleware, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { expressMiddlewareOrderingPredicate } from "../../src/predicates/express-middleware-ordering.js";

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

const mw = (name: string, import_source: string | null, position: number): ResolvedMiddleware => ({
  name,
  import_source,
  position,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
});

describe("expressMiddlewareOrderingPredicate (RULES-03)", () => {
  it("returns 'not-verified' when express.json appears in the chain (the canonical bug)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      middleware_chain: [mw("express.json", "express", 0)],
    };
    expect(await expressMiddlewareOrderingPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("returns 'not-verified' when body-parser.json is registered before route", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      middleware_chain: [mw("body-parser.json", "body-parser", 0), mw("authMiddleware", null, 1)],
    };
    expect(await expressMiddlewareOrderingPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("returns null when handler is non-Express (rule does not apply)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      framework: "hono",
      middleware_chain: [mw("express.json", "express", 0)],
    };
    expect(await expressMiddlewareOrderingPredicate(handler, {} as never)).toBeNull();
  });

  it("returns null when middleware_chain is empty", async () => {
    expect(await expressMiddlewareOrderingPredicate(baseHandler, {} as never)).toBeNull();
  });

  it("returns null when no JSON body parser is in the chain", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      middleware_chain: [mw("authMiddleware", null, 0), mw("rateLimit", null, 1)],
    };
    expect(await expressMiddlewareOrderingPredicate(handler, {} as never)).toBeNull();
  });

  it("matches `json` imported from express (alias form)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      middleware_chain: [mw("json", "express", 0)],
    };
    expect(await expressMiddlewareOrderingPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("does not match `json` from non-body-parser packages", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      middleware_chain: [mw("json", "some-other-pkg", 0)],
    };
    expect(await expressMiddlewareOrderingPredicate(handler, {} as never)).toBeNull();
  });

  it("returns null for non-Stripe providers (Stripe-branded rule must not fire cross-provider)", async () => {
    // Regression: a GitHub express handler with express.json()-before-route hits the same bug,
    // but github/raw-body-misuse owns it — this Stripe-namespaced rule firing here would emit a
    // "for Stripe" finding on a GitHub webhook (cross-provider false positive).
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "github",
      route_pattern: "/webhooks/github",
      middleware_chain: [mw("express.json", "express", 0)],
    };
    expect(await expressMiddlewareOrderingPredicate(handler, {} as never)).toBeNull();
  });
});
