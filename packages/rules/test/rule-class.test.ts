// Phase 19 v0.7.1 (RD-RELEASE-01) — rule-class taxonomy.
//
// Proves: (1) ruleClassOf extracts the trailing class segment; (2) the
// production-bypass group membership is correct (positive) AND excludes
// secret-leak / positive-signal classes (negative — the auditor-facing
// guarantee that --severity-class=production-bypass can't silently sweep in a
// leak rule, per [[feedback_negative_tests_required]]); (3) enumeration counts
// every bundled rule and the bundled pack contains zero unclassified
// production-bypass-looking classes drifting outside the curated set.

import { describe, expect, it } from "vitest";
import {
  ALL_PREDICATES,
  BUNDLED_RULE_DOCUMENTS,
  enumerateRuleClasses,
  loadRuleSet,
  PRODUCTION_BYPASS_CLASSES,
  PROVIDER_CATALOG,
  ruleClassOf,
  ruleInSeverityClassGroup,
  SEVERITY_CLASS_GROUP_NAMES,
} from "../src/index.js";

async function loadBundledRuleSet() {
  return loadRuleSet({
    rule_documents: BUNDLED_RULE_DOCUMENTS.map((e) => e.doc),
    predicates: ALL_PREDICATES,
    providers: PROVIDER_CATALOG,
    rule_pack_version: "0.0.0-test",
  });
}

describe("ruleClassOf", () => {
  it("extracts the trailing class segment from provider/class", () => {
    expect(ruleClassOf("stripe/test-mode-bypass")).toBe("test-mode-bypass");
    expect(ruleClassOf("github/missing-signature-verification")).toBe(
      "missing-signature-verification",
    );
  });

  it("returns the whole id when there is no slash", () => {
    expect(ruleClassOf("parse-error")).toBe("parse-error");
  });

  it("keeps only the final segment for multi-slash ids", () => {
    expect(ruleClassOf("a/b/c")).toBe("c");
  });
});

describe("production-bypass group — positive membership", () => {
  it.each([
    "stripe/missing-signature-verification",
    "stripe/raw-body-misuse",
    "github/test-mode-bypass",
    "shopify/verify-after-side-effect",
    "slack/verification-error-swallowed",
    "stripe/timing-unsafe-comparison",
    "stripe/empty-secret-bypass",
    "stripe/replay-window-too-permissive",
    "stripe/missing-timestamp-check",
  ])("%s is in production-bypass", (id) => {
    expect(ruleInSeverityClassGroup(id, "production-bypass")).toBe(true);
  });
});

describe("production-bypass group — negative (must NOT sweep in non-bypass classes)", () => {
  it.each([
    "auth0/secret-in-log-or-error", // a leak, not a request-acceptance bypass
    "stripe/hardcoded-secret-prefix", // secret hygiene
    "stripe/library-verified", // positive signal (verified state)
  ])("%s is NOT in production-bypass", (id) => {
    expect(ruleInSeverityClassGroup(id, "production-bypass")).toBe(false);
  });

  it("returns false for an unknown group name", () => {
    expect(ruleInSeverityClassGroup("stripe/test-mode-bypass", "does-not-exist")).toBe(false);
  });

  it("exposes exactly the shipped group names", () => {
    expect(SEVERITY_CLASS_GROUP_NAMES).toEqual(["production-bypass"]);
  });
});

describe("enumerateRuleClasses", () => {
  it("counts every rule and sorts by count desc then name", () => {
    const out = enumerateRuleClasses([
      "a/missing-signature-verification",
      "b/missing-signature-verification",
      "c/secret-in-log-or-error",
    ]);
    expect(out[0]).toEqual({
      cls: "missing-signature-verification",
      count: 2,
      production_bypass: true,
    });
    expect(out[1]).toEqual({ cls: "secret-in-log-or-error", count: 1, production_bypass: false });
    expect(out.reduce((n, c) => n + c.count, 0)).toBe(3);
  });

  it("tallies the full bundled pack with no rule dropped", async () => {
    const ruleSet = await loadBundledRuleSet();
    const ids = ruleSet.rules.map((r) => r.rule_id);
    const classes = enumerateRuleClasses(ids);
    expect(classes.reduce((n, c) => n + c.count, 0)).toBe(ids.length);
    // The bundled pack must contain at least one production-bypass rule.
    expect(classes.some((c) => c.production_bypass)).toBe(true);
  });

  it("every curated production-bypass class is non-empty (no stale taxonomy entries)", async () => {
    const ruleSet = await loadBundledRuleSet();
    const present = new Set(ruleSet.rules.map((r) => ruleClassOf(r.rule_id)));
    // Each curated class should still exist in the pack — guards against the
    // taxonomy drifting away from reality after a rule rename/removal.
    const stale = [...PRODUCTION_BYPASS_CLASSES].filter((c) => !present.has(c));
    expect(stale).toEqual([]);
  });
});
