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

  it("renders one critical finding with file:line:col, rule_id, [not-verified] badge, message, ↳ docs", () => {
    const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).toContain("CRITICAL");
    expect(out).toContain("src/server.ts:42:3");
    expect(out).toContain("stripe/missing-signature-verification");
    expect(out).toContain("[not-verified]");
    expect(out).toContain("Stripe webhook handler does not appear to verify");
    expect(out).toContain("↳ https://stripe.com/docs/webhooks");
  });

  it("groups findings by severity in fixed order: critical → high → medium → low → info", () => {
    const out = renderFindings(mkResult([manualReviewFinding, stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    const criticalIdx = out.indexOf("CRITICAL");
    const mediumIdx = out.indexOf("MEDIUM");
    expect(criticalIdx).toBeGreaterThanOrEqual(0);
    expect(mediumIdx).toBeGreaterThanOrEqual(0);
    expect(criticalIdx).toBeLessThan(mediumIdx);
  });

  it("renders [manual-review] badge inside its severity bucket (three-state moat)", () => {
    const out = renderFindings(mkResult([manualReviewFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).toContain("MEDIUM");
    expect(out).toContain("[manual-review]");
    expect(out).toContain("github/missing-timing-safe-equal");
  });

  it("W-2: emits ↳ provider_docs_url line when finding's rule_id maps to a rule with provider_docs_url", () => {
    const out = renderFindings(mkResult([stripeFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).toContain("↳ https://stripe.com/docs/webhooks");
  });

  it("W-2: omits ↳ line when rule is missing from ruleSet (engine/parse-error path)", () => {
    const out = renderFindings(mkResult([parseErrorFinding]), RULE_SET, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).not.toContain("↳");
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

  it("treats null ruleSet as empty rule index — omits all ↳ lines (parse-error path)", () => {
    const out = renderFindings(mkResult([stripeFinding, parseErrorFinding]), null, {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).not.toContain("↳");
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
});
