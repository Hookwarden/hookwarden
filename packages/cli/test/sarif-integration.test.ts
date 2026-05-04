// CLI-11 — verified GitHub Code Scanning round-trip.
// Runs only when SARIF_INTEGRATION_PAT is set (release-gate workflow only).
// PAT MUST be a fine-grained token with code-scanning:write on
// hookwarden/hookwarden-sarif-integration-test (see specifics §"SARIF integration
// test against real GitHub Code Scanning"). PR-time CI never has the secret —
// `describe.skipIf` ensures local dev + PR vitest runs skip cleanly.
//
// Test invariants (CLI-11 + ROADMAP success criterion 2 — upload half):
//  - 3 findings (critical, high, medium) round-trip with correct level mapping (D-60)
//  - re-uploading byte-identical SARIF dedups via partialFingerprints (D-76)
//  - cleanup: beforeAll AND afterAll both delete prior analyses (no cross-run state)
//  - PAT never logged to stdout/stderr (T-04-10-01 mitigation)
import { gzipSync } from "node:zlib";
import type {
  Finding,
  ProviderCatalog,
  RuleDefinition,
  RuleSet,
  ScanMetadata,
  ScanResult,
  Severity,
  Verdict,
} from "@hookwarden/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderSarif } from "../src/render/sarif.js";

const HAS_TOKEN = Boolean(process.env["SARIF_INTEGRATION_PAT"]);
const REPO =
  process.env["SARIF_INTEGRATION_REPO"] ?? "hookwarden/hookwarden-sarif-integration-test";
const REF = "refs/heads/main";
const COMMIT_SHA =
  process.env["SARIF_INTEGRATION_COMMIT_SHA"] ?? "0000000000000000000000000000000000000000";

interface UploadResponse {
  readonly id: string;
  readonly url: string;
}

interface SarifStatusResponse {
  readonly processing_status: "pending" | "complete" | "failed";
  readonly analyses_url?: string;
}

interface AlertLocation {
  readonly path: string;
  readonly start_line: number;
  readonly end_line?: number;
}

interface CodeScanningAlert {
  readonly rule: { readonly id: string; readonly severity: string };
  readonly most_recent_instance: { readonly location: AlertLocation };
}

function authHeaders(): Record<string, string> {
  const token = process.env["SARIF_INTEGRATION_PAT"];
  if (!token) throw new Error("SARIF_INTEGRATION_PAT not set");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function uploadSarif(sarifJson: string): Promise<UploadResponse> {
  const compressed = gzipSync(Buffer.from(sarifJson));
  const body = {
    commit_sha: COMMIT_SHA,
    ref: REF,
    sarif: compressed.toString("base64"),
    tool_name: "hookwarden",
  };
  const res = await fetch(`https://api.github.com/repos/${REPO}/code-scanning/sarifs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (res.status !== 202) {
    // Do NOT include the body in the error if it might echo the auth header.
    // The GitHub API does not echo the auth header in error responses; surface its body for diagnosis.
    throw new Error(`SARIF upload failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as UploadResponse;
}

async function pollUploadStatus(sarifId: string, timeoutMs = 180_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/code-scanning/sarifs/${sarifId}`,
      { headers: authHeaders() },
    );
    const body = (await res.json()) as SarifStatusResponse;
    if (body.processing_status === "complete" || body.processing_status === "failed") {
      return body.processing_status;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`SARIF processing did not complete within ${timeoutMs}ms`);
}

async function listAlerts(): Promise<ReadonlyArray<CodeScanningAlert>> {
  const url = `https://api.github.com/repos/${REPO}/code-scanning/alerts?ref=${encodeURIComponent(REF)}&tool_name=hookwarden`;
  const res = await fetch(url, { headers: authHeaders() });
  return (await res.json()) as ReadonlyArray<CodeScanningAlert>;
}

async function deleteAllAnalyses(): Promise<void> {
  // Per GitHub docs: deleting analyses must be done in newest-first order.
  // The list endpoint returns newest first — iterate as-returned with confirm_delete on every call
  // (GitHub requires confirm_delete=true once the next-to-delete would orphan alerts; safe to set always).
  const listUrl = `https://api.github.com/repos/${REPO}/code-scanning/analyses?ref=${encodeURIComponent(REF)}&tool_name=hookwarden`;
  const res = await fetch(listUrl, { headers: authHeaders() });
  if (!res.ok) return;
  const analyses = (await res.json()) as ReadonlyArray<{ id: number }>;
  for (const a of analyses) {
    await fetch(
      `https://api.github.com/repos/${REPO}/code-scanning/analyses/${a.id}?confirm_delete=true`,
      { method: "DELETE", headers: authHeaders() },
    );
  }
}

function mkScanMeta(): ScanMetadata {
  return {
    engine_version: "0.4.0",
    engine_commit_sha: "abc1234",
    rule_pack_version: "0.4.0",
    rule_pack_content_hash: "deadbeef",
    scanned_at: "2026-05-03T12:00:00.000Z",
    parse_errors_count: 0,
    parsed_files_count: 3,
    total_files_count: 3,
    parse_candidates_count: 3,
  };
}

function mkFinding(
  rule_id: string,
  provider: string,
  severity: Severity,
  state: Verdict,
  file_path: string,
  line: number,
  hash: string,
  message: string,
): Finding {
  return {
    id: `id-${rule_id}-${line}`,
    rule_id,
    provider,
    severity,
    state,
    file_path,
    location: { line, col: 1, end_line: line, end_col: 10 },
    snippet: "<redacted-snippet>",
    handler_id: null,
    primary_location_line_hash: hash,
    message,
    metadata: {},
    suppressed: null,
  };
}

function mkScanResult(): ScanResult {
  const findings: Finding[] = [
    mkFinding(
      "stripe/missing-signature-verification",
      "stripe",
      "critical",
      "not-verified",
      "src/webhooks/stripe.js",
      42,
      "a".repeat(64),
      "Stripe webhook handler does not verify the signature",
    ),
    mkFinding(
      "github/unsafe-comparison",
      "github",
      "high",
      "manual-review",
      "src/webhooks/github.ts",
      17,
      "b".repeat(64),
      "GitHub webhook signature comparison may be timing-unsafe",
    ),
    mkFinding(
      "stripe/library-verification",
      "stripe",
      "medium",
      "verified",
      "src/webhooks/stripe-good.js",
      8,
      "c".repeat(64),
      "Stripe handler uses constructEvent — verified",
    ),
  ];
  return { findings, inventory: [], metadata: mkScanMeta() };
}

function mkRule(
  rule_id: string,
  provider: string,
  severity: Severity,
  emits_state: Verdict,
  message: string,
  docs_url: string,
): RuleDefinition {
  return {
    rule_id,
    provider,
    severity,
    emits_state,
    message,
    matcher: null,
    predicate_name: null,
    applies_to: "all",
    provider_docs_url: docs_url,
    path_severity_overrides: null,
  };
}

function mkRuleSet(): RuleSet {
  const providers: ProviderCatalog = {
    stripe: { documentation_url: "https://stripe.com/docs" },
    github: { documentation_url: "https://docs.github.com/en/webhooks" },
  };
  const rules: RuleDefinition[] = [
    mkRule(
      "stripe/missing-signature-verification",
      "stripe",
      "critical",
      "not-verified",
      "Missing signature verification",
      "https://stripe.com/docs/webhooks/signatures",
    ),
    mkRule(
      "github/unsafe-comparison",
      "github",
      "high",
      "manual-review",
      "Timing-unsafe comparison",
      "https://docs.github.com/en/webhooks/securing",
    ),
    mkRule(
      "stripe/library-verification",
      "stripe",
      "medium",
      "verified",
      "Library-based verification recognized",
      "https://stripe.com/docs/webhooks/signatures",
    ),
  ];
  return {
    schema_version: 1,
    rule_pack_version: "0.4.0",
    providers,
    rules,
    predicates: {},
  };
}

describe.skipIf(!HAS_TOKEN)("SARIF integration — GitHub Code Scanning round-trip (CLI-11)", () => {
  beforeAll(async () => {
    await deleteAllAnalyses(); // start clean — leftover from a prior failed run
  });

  afterAll(async () => {
    await deleteAllAnalyses(); // leave clean for next run
  });

  it("uploads renderer output and round-trips every finding with correct level mapping", async () => {
    const sarif = renderSarif({ scanResult: mkScanResult(), ruleSet: mkRuleSet(), stale: [] });
    const { id } = await uploadSarif(sarif);
    const status = await pollUploadStatus(id);
    expect(status).toBe("complete");

    const alerts = await listAlerts();
    expect(alerts).toHaveLength(3);

    // Round-trip parity: file_path + level (D-60: critical/high → "error", medium → "warning")
    const byPath = new Map(alerts.map((a) => [a.most_recent_instance.location.path, a]));
    expect(byPath.has("src/webhooks/stripe.js")).toBe(true);
    expect(byPath.has("src/webhooks/github.ts")).toBe(true);
    expect(byPath.has("src/webhooks/stripe-good.js")).toBe(true);
    expect(byPath.get("src/webhooks/stripe.js")?.rule.severity).toBe("error");
    expect(byPath.get("src/webhooks/github.ts")?.rule.severity).toBe("error");
    expect(byPath.get("src/webhooks/stripe-good.js")?.rule.severity).toBe("warning");
  }, 240_000);

  it("re-uploading byte-identical SARIF dedups via partialFingerprints (D-76)", async () => {
    // Upload #1
    const result = mkScanResult();
    const ruleSet = mkRuleSet();
    const sarif = renderSarif({ scanResult: result, ruleSet, stale: [] });
    const { id: id1 } = await uploadSarif(sarif);
    await pollUploadStatus(id1);
    const alerts1 = await listAlerts();
    expect(alerts1).toHaveLength(3);

    // Upload #2 — byte-identical (Plan 08 byte-stability test guarantees determinism)
    const sarif2 = renderSarif({ scanResult: result, ruleSet, stale: [] });
    expect(sarif2).toBe(sarif); // sanity check on renderer determinism
    const { id: id2 } = await uploadSarif(sarif2);
    await pollUploadStatus(id2);
    const alerts2 = await listAlerts();

    // No NEW alerts — same partialFingerprints dedup.
    // Per CLI-11 "no silent finding de-duplication": GitHub's dedup must happen because
    // we send the SAME fingerprints, NOT because GitHub is silently dropping different
    // findings. Count parity is the round-trip evidence.
    expect(alerts2.length).toBe(3);
  }, 420_000);
});
