import type {
  Finding,
  RuleDefinition,
  RuleSet,
  ScanMetadata,
  ScanResult,
} from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { renderFindings } from "../src/render/findings.js";

const META: ScanMetadata = {
  engine_version: "0.0.1",
  engine_commit_sha: null,
  rule_pack_version: "0.0.1",
  rule_pack_content_hash: "deadbeef",
  scanned_at: "2026-05-03T00:00:00.000Z",
  parse_errors_count: 0,
  parsed_files_count: 1,
  total_files_count: 1,
};

const stripeRule: RuleDefinition = {
  rule_id: "stripe/missing-signature-verification",
  provider: "stripe",
  severity: "critical",
  emits_state: "not-verified",
  message: "Stripe webhook handler does not appear to verify the signature header.",
  matcher: null,
  predicate_name: "stripe-missing-signature-verification",
  applies_to: "all",
  provider_docs_url: "https://stripe.com/docs/webhooks",
  path_severity_overrides: null,
};

const githubRule: RuleDefinition = {
  rule_id: "github/missing-timing-safe-equal",
  provider: "github",
  severity: "high",
  emits_state: "not-verified",
  message: "Use crypto.timingSafeEqual to compare signatures.",
  matcher: null,
  predicate_name: "github-timing-safe-equal",
  applies_to: "all",
  provider_docs_url:
    "https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries",
  path_severity_overrides: null,
};

const stripeFinding: Finding = {
  id: "f1",
  rule_id: stripeRule.rule_id,
  provider: "stripe",
  severity: "critical",
  state: "not-verified",
  file_path: "src/server.ts",
  location: { line: 42, col: 3, end_line: 42, end_col: 5 },
  snippet: "...",
  handler_id: "h1",
  primary_location_line_hash: "h1",
  message: stripeRule.message,
  metadata: {},
};

const manualReviewFinding: Finding = {
  id: "f2",
  rule_id: githubRule.rule_id,
  provider: "github",
  severity: "medium",
  state: "manual-review",
  file_path: "src/gh.ts",
  location: { line: 7, col: 1, end_line: 7, end_col: 2 },
  snippet: "",
  handler_id: "h2",
  primary_location_line_hash: "h2",
  message: githubRule.message,
  metadata: {},
};

const parseErrorFinding: Finding = {
  id: "f3",
  rule_id: "engine/parse-error",
  provider: "engine",
  severity: "low",
  state: "manual-review",
  file_path: "src/broken.ts",
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  snippet: "",
  handler_id: null,
  primary_location_line_hash: "h3",
  message: "Parse error: unexpected token",
  metadata: {},
};

const RULE_SET: RuleSet = {
  schema_version: 1,
  rule_pack_version: "0.0.1",
  providers: {},
  rules: [stripeRule, githubRule],
  predicates: {},
};

function mkResult(findings: ReadonlyArray<Finding>): ScanResult {
  return { findings, inventory: [], metadata: META };
}

describe("renderFindings", () => {
  it("returns 'No findings.\\n' when result has zero findings", () => {
    const out = renderFindings(mkResult([]), RULE_SET, { useAnsi: false, cwd: "/tmp" });
    expect(out).toBe("No findings.\n");
  });

  it("renders one critical finding with severity glyph + file:line:col + rule_id + state + message + docs › link", () => {
    const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    // Compact layout (post-redesign): `× critical  file:line:col  rule_id  state`
    // on one line; severity is communicated by glyph + lowercase label (no
    // banner section, no upper-case CRITICAL/MEDIUM/... title).
    expect(out).toContain("× critical");
    expect(out).toContain("src/server.ts:42:3");
    expect(out).toContain("stripe/missing-signature-verification");
    expect(out).toContain("not-verified");
    expect(out).toContain("Stripe webhook handler does not appear to verify");
    expect(out).toContain("docs › https://stripe.com/docs/webhooks");
  });

  it("orders findings by severity desc (critical before medium) without a banner section header", () => {
    const out = renderFindings(mkResult([manualReviewFinding, stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    // Severity-desc → file → line ordering; the critical header column lands
    // before the medium header column regardless of input order.
    const criticalIdx = out.indexOf("× critical");
    const mediumIdx = out.indexOf("▲ medium");
    expect(criticalIdx).toBeGreaterThanOrEqual(0);
    expect(mediumIdx).toBeGreaterThanOrEqual(0);
    expect(criticalIdx).toBeLessThan(mediumIdx);
    // And the prior "CRITICAL\n────" banner is gone — no more full-width
    // severity-section separators dominating the output.
    expect(out).not.toContain("────");
    expect(out).not.toContain("CRITICAL");
  });

  it("renders manual-review state in its severity row (three-state moat)", () => {
    const out = renderFindings(mkResult([manualReviewFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).toContain("▲ medium");
    expect(out).toContain("manual-review");
    expect(out).toContain("github/missing-timing-safe-equal");
  });

  it("W-2: emits docs › provider_docs_url line when finding's rule_id maps to a rule with provider_docs_url", () => {
    const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).toContain("docs › https://stripe.com/docs/webhooks");
  });

  it("W-2: omits docs › line when rule is missing from ruleSet (engine/parse-error path)", () => {
    const out = renderFindings(mkResult([parseErrorFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).not.toContain("docs ›");
  });

  it("emits OSC-8 file:// hyperlink when useAnsi is true", () => {
    const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
      useAnsi: true,
      cwd: "/tmp",
    });
    // OSC-8 sequence prefix: ESC ] 8 ; ;
    expect(out).toContain("]8;;file:///tmp/src/server.ts:42:3");
  });

  it("does not emit OSC-8 sequences when useAnsi is false", () => {
    const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).not.toContain("]8;;");
  });

  it("treats null ruleSet as empty rule index — omits all docs › lines (parse-error path)", () => {
    const out = renderFindings(mkResult([stripeFinding, parseErrorFinding]), null, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).not.toContain("docs ›");
  });

  it("sorts findings deterministically within a severity bucket: file_path → line → col → rule_id", () => {
    const a: Finding = {
      ...stripeFinding,
      id: "a",
      file_path: "a/x.ts",
      location: { line: 1, col: 1, end_line: 1, end_col: 2 },
    };
    const b: Finding = {
      ...stripeFinding,
      id: "b",
      file_path: "b/x.ts",
      location: { line: 1, col: 1, end_line: 1, end_col: 2 },
    };
    const c: Finding = {
      ...stripeFinding,
      id: "c",
      file_path: "a/x.ts",
      location: { line: 2, col: 1, end_line: 2, end_col: 2 },
    };
    const out = renderFindings(mkResult([b, c, a]), RULE_SET, { useAnsi: false, cwd: "/tmp" });
    const aIdx = out.indexOf("a/x.ts:1:1");
    const cIdx = out.indexOf("a/x.ts:2:1");
    const bIdx = out.indexOf("b/x.ts:1:1");
    expect(aIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(bIdx);
  });

  it("snapshot — zero findings", () => {
    const out = renderFindings(mkResult([]), RULE_SET, { useAnsi: false, cwd: "/tmp" });
    expect(out).toMatchSnapshot();
  });

  it("snapshot — one critical finding (canonical Stripe bug)", () => {
    const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).toMatchSnapshot();
  });

  it("snapshot — mixed severities + manual-review + parse-error", () => {
    const out = renderFindings(
      mkResult([stripeFinding, manualReviewFinding, parseErrorFinding]),
      RULE_SET,
      { useAnsi: false, cwd: "/tmp" },
    );
    expect(out).toMatchSnapshot();
  });

  it("manual-review (rule-pack rule): emits `next ›` line with baseline-write guidance", () => {
    const out = renderFindings(mkResult([manualReviewFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).toContain("next ›");
    expect(out).toContain("hookwarden scan --baseline write");
    expect(out).toContain("review the handler in context");
  });

  it("NEGATIVE manual-review (engine/parse-error, not in ruleSet): does NOT emit `next ›` line", () => {
    // Parse errors are pseudo-findings; baseline-write doesn't apply.
    const out = renderFindings(mkResult([parseErrorFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).not.toContain("next ›");
  });

  it("NEGATIVE not-verified finding: does NOT emit `next ›` line (verdict already actionable)", () => {
    const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).not.toContain("next ›");
  });

  // v0.7.1 references rendering — external citations from rule.references
  describe("v0.7.1 references block (`refs ›`)", () => {
    const stripeRuleWithRefs: RuleDefinition = {
      ...stripeRule,
      references: [
        "https://www.svix.com/blog/common-failure-modes-for-webhook-signatures/",
        "https://hookdeck.com/webhooks/guides/webhook-security-vulnerabilities-guide",
        "CWE-345 — Insufficient Verification of Data Authenticity",
      ],
    };
    const ruleSetWithRefs: RuleSet = { ...RULE_SET, rules: [stripeRuleWithRefs, githubRule] };

    it("emits `refs ›` prefix with the first reference inline", () => {
      const out = renderFindings(mkResult([stripeFinding]), ruleSetWithRefs, {
        useAnsi: false,
        cwd: "/tmp",
      });
      expect(out).toContain(
        "refs › https://www.svix.com/blog/common-failure-modes-for-webhook-signatures/",
      );
    });

    it("renders continuation references aligned under the first (7-space indent)", () => {
      const out = renderFindings(mkResult([stripeFinding]), ruleSetWithRefs, {
        useAnsi: false,
        cwd: "/tmp",
      });
      // 2-space body indent + 7-space `refs › ` width = 9 chars before continuation
      expect(out).toContain(
        "         https://hookdeck.com/webhooks/guides/webhook-security-vulnerabilities-guide",
      );
      expect(out).toContain("         CWE-345 — Insufficient Verification of Data Authenticity");
    });

    it("renders refs block AFTER the docs › line — independent evidence sources, not a replacement", () => {
      const out = renderFindings(mkResult([stripeFinding]), ruleSetWithRefs, {
        useAnsi: false,
        cwd: "/tmp",
      });
      const docsIdx = out.indexOf("docs › https://stripe.com/docs/webhooks");
      const refsIdx = out.indexOf("refs ›");
      expect(docsIdx).toBeGreaterThanOrEqual(0);
      expect(refsIdx).toBeGreaterThan(docsIdx);
    });

    it("NEGATIVE: rule with references: null emits no refs block", () => {
      const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
        useAnsi: false,
        cwd: "/tmp",
      });
      expect(out).not.toContain("refs ›");
    });

    it("NEGATIVE: rule with references: [] (empty) emits no refs block", () => {
      const emptyRefsRule: RuleDefinition = { ...stripeRule, references: [] };
      const ruleSet: RuleSet = { ...RULE_SET, rules: [emptyRefsRule, githubRule] };
      const out = renderFindings(mkResult([stripeFinding]), ruleSet, {
        useAnsi: false,
        cwd: "/tmp",
      });
      expect(out).not.toContain("refs ›");
    });
  });
});
