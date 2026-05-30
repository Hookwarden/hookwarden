// VAS-01 predicate tests. The predicate is a thin consumer of the engine's
// `side_effect_before_verify` evidence (emitted by model/handler-cfg.ts at
// the engine layer). These tests assert the predicate's contract directly
// with hand-built WebhookHandler fixtures; the engine-side overlay is
// tested separately in @hookwarden/engine test/model/handler-cfg.test.ts.

import type { WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import {
  __test_only,
  createVerifyAfterSideEffectPredicate,
} from "../src/predicates/verify-after-side-effect.js";

function makeHandler(overrides: Partial<WebhookHandler>): WebhookHandler {
  return {
    id: "h",
    framework: "express",
    framework_version: null,
    route_pattern: "/webhooks/stripe",
    http_methods: ["POST"],
    file_path: "src/server.ts",
    location: { line: 1, col: 1, end_line: 2, end_col: 1 },
    handler_function_name: "handler",
    provider: "stripe",
    verification_state: "manual-review",
    evidence: [],
    middleware_chain: [],
    reachable_symbols: [],
    findings_ref: [],
    redacted_snippet: "",
    ...overrides,
  };
}

describe("verify-after-side-effect predicate — happy path", () => {
  it("emits manual-review when side_effect_before_verify evidence is attached", async () => {
    const predicate = createVerifyAfterSideEffectPredicate("stripe");
    const handler = makeHandler({
      evidence: [
        {
          kind: "side_effect_before_verify",
          provider: "stripe",
          location: { line: 5, col: 1, end_line: 5, end_col: 30 },
          detail: "prisma.user.create",
        },
      ],
    });
    const verdict = await predicate(handler, {} as never);
    expect(verdict).toBe("manual-review");
  });

  it("emits manual-review for multiple side-effect evidences", async () => {
    const predicate = createVerifyAfterSideEffectPredicate("stripe");
    const handler = makeHandler({
      evidence: [
        {
          kind: "side_effect_before_verify",
          provider: "stripe",
          location: { line: 5, col: 1, end_line: 5, end_col: 30 },
          detail: "prisma.user.create",
        },
        {
          kind: "side_effect_before_verify",
          provider: "stripe",
          location: { line: 7, col: 1, end_line: 7, end_col: 30 },
          detail: "emitter.emit",
        },
      ],
    });
    const verdict = await predicate(handler, {} as never);
    expect(verdict).toBe("manual-review");
  });
});

describe("verify-after-side-effect predicate — null (does not apply)", () => {
  it("returns null when no side_effect_before_verify evidence is present", async () => {
    const predicate = createVerifyAfterSideEffectPredicate("stripe");
    const handler = makeHandler({
      evidence: [
        // Other evidence kinds are irrelevant to this rule.
        {
          kind: "sdk_verify_call",
          provider: "stripe",
          location: { line: 1, col: 1, end_line: 1, end_col: 30 },
          detail: "webhooks.constructEvent",
        },
      ],
    });
    const verdict = await predicate(handler, {} as never);
    expect(verdict).toBeNull();
  });

  it("returns null for a non-Stripe handler (contract-violation: provider must match)", async () => {
    const predicate = createVerifyAfterSideEffectPredicate("stripe");
    const handler = makeHandler({
      provider: "github",
      evidence: [
        {
          kind: "side_effect_before_verify",
          provider: "stripe", // engine attribution lagging — predicate must filter by handler.provider
          location: { line: 5, col: 1, end_line: 5, end_col: 30 },
          detail: "prisma.user.create",
        },
      ],
    });
    const verdict = await predicate(handler, {} as never);
    expect(verdict).toBeNull();
  });

  it("returns null when evidence kind is side_effect_before_verify but provider is different (cross-attribution)", async () => {
    const predicate = createVerifyAfterSideEffectPredicate("stripe");
    const handler = makeHandler({
      evidence: [
        {
          kind: "side_effect_before_verify",
          provider: "github", // mis-attributed evidence
          location: { line: 5, col: 1, end_line: 5, end_col: 30 },
          detail: "prisma.user.create",
        },
      ],
    });
    const verdict = await predicate(handler, {} as never);
    expect(verdict).toBeNull();
  });

  it("returns null on a handler with empty evidence array", async () => {
    const predicate = createVerifyAfterSideEffectPredicate("stripe");
    const handler = makeHandler({ evidence: [] });
    expect(await predicate(handler, {} as never)).toBeNull();
  });
});

describe("verify-after-side-effect predicate — factory shape", () => {
  it("each factory invocation produces an independent predicate scoped to its provider", async () => {
    const stripePred = createVerifyAfterSideEffectPredicate("stripe");
    const githubPred = createVerifyAfterSideEffectPredicate("github");
    const stripeHandler = makeHandler({
      provider: "stripe",
      evidence: [
        {
          kind: "side_effect_before_verify",
          provider: "stripe",
          location: { line: 5, col: 1, end_line: 5, end_col: 30 },
          detail: "prisma.user.create",
        },
      ],
    });
    expect(await stripePred(stripeHandler, {} as never)).toBe("manual-review");
    expect(await githubPred(stripeHandler, {} as never)).toBeNull();
  });
});

describe("__test_only — filterSideEffectEvidence", () => {
  it("returns only side_effect_before_verify evidence matching the provider", () => {
    const handler = makeHandler({
      evidence: [
        {
          kind: "side_effect_before_verify",
          provider: "stripe",
          location: { line: 5, col: 1, end_line: 5, end_col: 30 },
          detail: "prisma.user.create",
        },
        {
          kind: "sdk_verify_call",
          provider: "stripe",
          location: { line: 1, col: 1, end_line: 1, end_col: 30 },
          detail: "webhooks.constructEvent",
        },
        {
          kind: "side_effect_before_verify",
          provider: "github",
          location: { line: 5, col: 1, end_line: 5, end_col: 30 },
          detail: "prisma.user.create",
        },
      ],
    });
    const filtered = __test_only.filterSideEffectEvidence(handler, "stripe");
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.detail).toBe("prisma.user.create");
  });
});
