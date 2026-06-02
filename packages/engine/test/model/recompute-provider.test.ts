// Regression tests for recomputeProvider — provider attribution from evidence counts.
//
// Bug (08.3 Plan 16b follow-up): generic stdlib crypto primitives (createHmac / timingSafeEqual)
// that some catalog entries (anthropic-agent-sdk, n8n) list in sdk_verify_calls as VAS-01
// suppression anchors were ALSO counted for provider attribution. A correctly-verified hand-rolled
// handler (createHmac + timingSafeEqual = 2 generic anthropic hits) out-voted its true provider's
// single header signal and was mis-attributed (e.g. Standard Webhooks → anthropic-agent-sdk).
// recomputeProvider now excludes generic-crypto sdk_verify_call evidence from the attribution tally.

import { describe, expect, it } from "vitest";
import { recomputeProvider } from "../../src/model/build.js";
import type { WebhookEvidence, WebhookEvidenceKind } from "../../src/types/handler.js";

const ev = (kind: WebhookEvidenceKind, provider: string, detail: string): WebhookEvidence => ({
  kind,
  provider,
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  detail,
});

describe("recomputeProvider — generic-crypto sdk_verify_call exclusion", () => {
  it("attributes a hand-rolled Standard Webhooks handler to standardwebhooks, NOT anthropic-agent-sdk", () => {
    // The exact bug shape: 1 standardwebhooks header signal vs 2 generic-crypto anthropic anchors.
    const evidence: WebhookEvidence[] = [
      ev("signature_header_read", "standardwebhooks", "webhook-signature"),
      ev("sdk_verify_call", "anthropic-agent-sdk", "createHmac"),
      ev("sdk_verify_call", "anthropic-agent-sdk", "crypto.timingSafeEqual"),
    ];
    expect(recomputeProvider(evidence, "unknown")).toBe("standardwebhooks");
  });

  it("still attributes a genuine anthropic-agent-sdk handler (sdk_import survives the filter)", () => {
    const evidence: WebhookEvidence[] = [
      ev("sdk_import", "anthropic-agent-sdk", "@anthropic-ai/claude-agent-sdk"),
      ev("sdk_verify_call", "anthropic-agent-sdk", "createHmac"),
    ];
    expect(recomputeProvider(evidence, "unknown")).toBe("anthropic-agent-sdk");
  });

  it("keeps provider-specific sdk_verify_call evidence as an identifying signal (stripe)", () => {
    const evidence: WebhookEvidence[] = [
      ev("sdk_verify_call", "stripe", "webhooks.constructEvent"),
    ];
    expect(recomputeProvider(evidence, "unknown")).toBe("stripe");
  });

  it("does NOT regress n8n's getHeaderData (n8n-specific verify call still counts)", () => {
    const evidence: WebhookEvidence[] = [
      ev("sdk_verify_call", "n8n", "getHeaderData"),
      ev("sdk_verify_call", "n8n", "timingSafeEqual"),
    ];
    expect(recomputeProvider(evidence, "unknown")).toBe("n8n");
  });

  it("returns the fallback when only generic-crypto evidence is present (no identifying signal)", () => {
    const evidence: WebhookEvidence[] = [
      ev("sdk_verify_call", "anthropic-agent-sdk", "createHmac"),
      ev("sdk_verify_call", "anthropic-agent-sdk", "timingSafeEqual"),
    ];
    expect(recomputeProvider(evidence, "unknown")).toBe("unknown");
  });

  it("returns 'multiple' on a genuine tie between two identifying signals", () => {
    const evidence: WebhookEvidence[] = [
      ev("signature_header_read", "standardwebhooks", "webhook-signature"),
      ev("signature_header_read", "github", "x-hub-signature-256"),
    ];
    expect(recomputeProvider(evidence, "unknown")).toBe("multiple");
  });

  it("ignores unknown-provider evidence entirely", () => {
    const evidence: WebhookEvidence[] = [
      ev("signature_header_read", "unknown", "x-custom"),
      ev("signature_header_read", "standardwebhooks", "webhook-signature"),
    ];
    expect(recomputeProvider(evidence, "unknown")).toBe("standardwebhooks");
  });
});
