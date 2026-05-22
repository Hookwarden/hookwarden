// Phase 8.2 Plan 02 + Plan 11: schema validation for the `fix:` discriminated-union block.
//
// B4 stage 2 — Plan 11 wave 8 tightened the schema to require the `fix` key.
// Test 1 now asserts REJECTED for the missing-key case (flipped from ACCEPTED
// in Plan 02 wave 1, when the schema kept fix optional through waves 1-7).
//
// Per [[feedback_negative_tests_required]] — 5 of the 8 cases are negative
// (Tests 1, 4, 5, 7, 8). The negative tests are the explicit-binary contract:
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
  // Test 1 — Plan 11 wave 8 tightened: `fix` is REQUIRED. Missing-key is rejected.
  it("Test 1 — REJECTS rule with `fix:` key omitted (D-04 explicit-binary after Plan 11)", () => {
    expect(() => validateRuleDocument({ ...BASE_DOC })).toThrow(/invalid rule document/);
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
