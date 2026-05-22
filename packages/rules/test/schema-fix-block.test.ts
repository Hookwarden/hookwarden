// Phase 8.2 Plan 02: schema validation for the new `fix:` discriminated-union block.
//
// B4 — schema_required tightening deferred to Plan 11 wave 7.
// In this plan: Test 1 asserts ACCEPTED for the missing-key case (fix is optional).
// In Plan 11 wave 7's task: Test 1 is REWRITTEN to assert REJECTED after `fix` is added to required[].
// The earlier "option (a) atomic merge" path is withdrawn per checker B4.
//
// Per [[feedback_negative_tests_required]] — 4 of the 8 cases are negative
// (Tests 4, 5, 7, 8). The negative tests are the explicit-binary contract:
// they prove the schema closes the door on the failure modes that produce
// half-supported `--fix` rule pack metadata.

import { describe, expect, it } from "vitest";
import { validateRuleDocument } from "../src/schema.js";

// Minimal valid base document — varied only by the `fix:` field in each test.
const BASE_DOC = {
  schema_version: 1,
  rule_id: "stripe/timing-unsafe-comparison",
  provider: "stripe",
  severity: "critical",
  emits_state: "not-verified",
  message: "Stripe handler uses == instead of timingSafeEqual",
  matcher: null,
  predicate: "stripe-timing-unsafe-comparison",
  applies_to: ["express"],
  provider_docs_url: "https://stripe.com/docs/webhooks/signatures",
} as const;

describe("schema fix: block (Phase 8.2 D-01 + D-15)", () => {
  // Test 1 — B4 — `fix:` is OPTIONAL in this plan. Plan 11 wave 7 tightens.
  it("Test 1 — ACCEPTS rule with `fix:` key omitted (B4 — tightening deferred to Plan 11)", () => {
    const doc = validateRuleDocument({ ...BASE_DOC });
    // validateRuleDocument normalizes undefined → null at the boundary so downstream
    // consumers can rely on `fix !== undefined`.
    expect(doc.fix).toBeNull();
  });

  // Test 2 — explicit-binary signal: fix is null.
  it("Test 2 — ACCEPTS `fix: null` (D-15 explicit-binary signal)", () => {
    const doc = validateRuleDocument({ ...BASE_DOC, fix: null });
    expect(doc.fix).toBeNull();
  });

  // Test 3 — fully populated safe-fix metadata.
  it("Test 3 — ACCEPTS `fix: { safety: safe, description, codegen: <id> }`", () => {
    const doc = validateRuleDocument({
      ...BASE_DOC,
      fix: {
        safety: "safe",
        description: "Replace === with crypto.timingSafeEqual(...)",
        codegen: "typescript-replace-binary-equality",
      },
    });
    expect(doc.fix).toEqual({
      safety: "safe",
      description: "Replace === with crypto.timingSafeEqual(...)",
      codegen: "typescript-replace-binary-equality",
    });
  });

  // Test 4 — negative — codegen required for safe.
  it("Test 4 — REJECTS `fix: { safety: safe, codegen: null }` (D-15)", () => {
    expect(() =>
      validateRuleDocument({
        ...BASE_DOC,
        fix: {
          safety: "safe",
          description: "should fail",
          codegen: null,
        },
      }),
    ).toThrow(/codegen MUST be a non-empty string when fix\.safety is safe or unsafe/);
  });

  // Test 5 — negative — codegen must be null for manual-only.
  it("Test 5 — REJECTS `fix: { safety: manual-only, codegen: <id> }` (D-15)", () => {
    expect(() =>
      validateRuleDocument({
        ...BASE_DOC,
        fix: {
          safety: "manual-only",
          description: "should fail",
          codegen: "any-id",
        },
      }),
    ).toThrow(/codegen MUST be null when fix\.safety is manual-only/);
  });

  // Test 6 — manual-only carries codegen: null.
  it("Test 6 — ACCEPTS `fix: { safety: manual-only, codegen: null }`", () => {
    const doc = validateRuleDocument({
      ...BASE_DOC,
      fix: {
        safety: "manual-only",
        description: "Wrap route in middleware per provider docs.",
        codegen: null,
      },
    });
    expect(doc.fix).toEqual({
      safety: "manual-only",
      description: "Wrap route in middleware per provider docs.",
      codegen: null,
    });
  });

  // Test 7 — negative — unknown safety value rejected by enum.
  it("Test 7 — REJECTS unknown safety enum value", () => {
    expect(() =>
      validateRuleDocument({
        ...BASE_DOC,
        fix: {
          safety: "unknown",
          description: "x",
          codegen: "y",
        },
      }),
    ).toThrow(/invalid rule document/);
  });

  // Test 8 — negative — empty description rejected by minLength.
  it("Test 8 — REJECTS empty description", () => {
    expect(() =>
      validateRuleDocument({
        ...BASE_DOC,
        fix: {
          safety: "safe",
          description: "",
          codegen: "y",
        },
      }),
    ).toThrow(/invalid rule document/);
  });
});
