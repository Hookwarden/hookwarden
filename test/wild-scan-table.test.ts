import { describe, expect, it } from "vitest";

import { type Aggregate, renderTable } from "../.github/scripts/wild-scan";

// Mirrors the real 2026-06-09 sweep aggregate (see the wild-scan run log):
// Stripe + Slack are core providers; n8n + standardwebhooks fire but are NOT
// in the old hardcoded provider list; engine/parse-error dominates manual-review.
function sampleAggregate(overrides: Partial<Aggregate> = {}): Aggregate {
  return {
    targetsScanned: 45,
    targetsClean: 20,
    findings: { critical: 94, high: 7, medium: 0, low: 0, info: 0, manualReview: 239 },
    byRuleId: {
      "engine/parse-error": 238,
      "n8n/missing-signature-verification": 78,
      "n8n/raw-body-misuse": 3,
      "standardwebhooks/missing-signature-verification": 3,
      "standardwebhooks/raw-body-misuse": 4,
      "stripe/missing-signature-verification": 4,
      "stripe/hardcoded-secret-prefix": 2,
      "slack/missing-signature-verification": 7,
      "slack/verify-after-side-effect": 1,
    },
    byProvider: {
      stripe: {
        critical: 6,
        high: 0,
        manualReview: 0,
        rules: { "stripe/missing-signature-verification": 4, "stripe/hardcoded-secret-prefix": 2 },
      },
      slack: {
        critical: 7,
        high: 0,
        manualReview: 1,
        rules: { "slack/missing-signature-verification": 7, "slack/verify-after-side-effect": 1 },
      },
      n8n: {
        critical: 78,
        high: 3,
        manualReview: 0,
        rules: { "n8n/missing-signature-verification": 78, "n8n/raw-body-misuse": 3 },
      },
      standardwebhooks: {
        critical: 3,
        high: 4,
        manualReview: 0,
        rules: {
          "standardwebhooks/missing-signature-verification": 3,
          "standardwebhooks/raw-body-misuse": 4,
        },
      },
      engine: {
        critical: 0,
        high: 0,
        manualReview: 238,
        rules: { "engine/parse-error": 238 },
      },
    },
    failed: ["parse-community/parse-server"],
    ...overrides,
  };
}

describe("wild-scan renderTable", () => {
  it("renders providers that fired but are NOT in the core list (n8n, standardwebhooks)", () => {
    const out = renderTable(sampleAggregate());
    expect(out).toContain("n8n integrations");
    expect(out).toContain("Standard Webhooks integrations");
    // n8n's real 78 critical must appear, not be silently dropped.
    expect(out).toContain("| n8n integrations | 78 | 3 |");
  });

  it("keeps core providers visible even at zero findings (breadth proof)", () => {
    const out = renderTable(sampleAggregate());
    expect(out).toContain("| GitHub integrations | 0 | 0 | 0 | — |");
    expect(out).toContain("| Twilio integrations | 0 | 0 | 0 | — |");
  });

  it("excludes the engine/parse-error row from the table but discloses it as a footnote", () => {
    const out = renderTable(sampleAggregate());
    // No table row for engine diagnostics...
    expect(out).not.toMatch(/\|\s*Engine[^|]*\|/);
    expect(out).not.toContain("`engine/parse-error` (×");
    // ...but the count is surfaced honestly in prose.
    expect(out).toContain("couldn't parse **238** files");
  });

  it("sorts the most severe provider first", () => {
    const out = renderTable(sampleAggregate());
    // n8n (78 critical) must come before stripe (6 critical).
    expect(out.indexOf("n8n integrations")).toBeLessThan(out.indexOf("Stripe integrations"));
  });

  it("keeps the canonical '21 providers' claim and a non-hardcoded framing note", () => {
    const out = renderTable(sampleAggregate());
    expect(out).toContain("across **21 providers**");
    // Framing note must not re-hardcode the stale 6-provider list.
    expect(out).not.toContain("not in Stripe / GitHub / Shopify / Slack / Twilio / Square");
  });

  // Negative / forward-compat: a brand-new provider the label map has never
  // seen must still render (via fallback) and never be dropped.
  it("renders an unknown future provider via the label fallback", () => {
    const out = renderTable(
      sampleAggregate({
        byProvider: {
          ...sampleAggregate().byProvider,
          paddle: {
            critical: 2,
            high: 0,
            manualReview: 0,
            rules: { "paddle/missing-signature-verification": 2 },
          },
        },
      }),
    );
    expect(out).toContain("Paddle integrations");
    expect(out).toContain("`paddle/missing-signature-verification` (×2)");
  });

  // Edge: no parse errors → no coverage footnote (don't print "0 files").
  it("omits the coverage footnote when there are no parse errors", () => {
    const out = renderTable(
      sampleAggregate({ byRuleId: { "stripe/missing-signature-verification": 4 } }),
    );
    expect(out).not.toContain("couldn't parse");
  });
});
