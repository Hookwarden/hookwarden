import { describe, expect, it } from "vitest";
import type {
  Config,
  Finding,
  ProviderCatalogEntry,
  RuleSet,
  ScanMetadata,
  ScanResult,
  WebhookEvidence,
  WebhookHandler,
} from "../../src/types/index.ts";

// A typed sample that uses every locked field. If any contract field is renamed/removed,
// this file fails to compile — `pnpm exec tsc --noEmit` blocks the regression in CI.
const sampleHandler: WebhookHandler = {
  id: "0".repeat(64),
  framework: "express",
  framework_version: "express@4",
  route_pattern: "/webhooks/stripe",
  http_methods: ["POST"],
  file_path: "src/webhooks/stripe.ts",
  location: { line: 12, col: 1, end_line: 30, end_col: 1 },
  handler_function_name: "handleStripe",
  provider: "stripe",
  verification_state: "verified",
  evidence: [
    {
      kind: "sdk_verify_call",
      provider: "stripe",
      location: { line: 15, col: 3, end_line: 15, end_col: 60 },
      detail: "stripe.webhooks.constructEvent",
    } satisfies WebhookEvidence,
  ],
  middleware_chain: [],
  reachable_symbols: [],
  findings_ref: [],
  redacted_snippet: "<TEMPLATE>",
};

const sampleFinding: Finding = {
  id: "1".repeat(64),
  rule_id: "stripe/missing-verification",
  provider: "stripe",
  severity: "critical",
  state: "not-verified",
  file_path: "src/webhooks/stripe.ts",
  location: { line: 12, col: 1, end_line: 30, end_col: 1 },
  snippet: "<TEMPLATE>",
  handler_id: sampleHandler.id,
  primary_location_line_hash: "2".repeat(64),
  message: "stripe webhook not verified",
  metadata: {},
};

const sampleMetadata: ScanMetadata = {
  engine_version: "0.0.1",
  engine_commit_sha: null,
  rule_pack_version: "0.0.1",
  rule_pack_content_hash: "3".repeat(64),
  scanned_at: "2026-05-02T00:00:00Z",
  parse_errors_count: 0,
  parsed_files_count: 1,
  total_files_count: 1,
};

const sampleScanResult: ScanResult = {
  findings: [sampleFinding],
  inventory: [sampleHandler],
  metadata: sampleMetadata,
};

const sampleProvider: ProviderCatalogEntry = {
  signature_header: ["stripe-signature"],
  sdk_packages: ["stripe"],
  sdk_verify_calls: ["webhooks.constructEvent"],
  secret_env_prefix: ["STRIPE_WEBHOOK"],
  secret_literal_prefix: ["whsec_"],
  conventional_paths: ["/webhooks/stripe"],
};

const sampleRuleSet: RuleSet = {
  schema_version: 1,
  rule_pack_version: "0.0.1",
  providers: { stripe: sampleProvider },
  rules: [],
  predicates: {},
};

const sampleConfig: Config = {
  reachability_max_depth: 3,
  scanned_at: "2026-05-02T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
};

describe("public type contract", () => {
  it("ScanResult.metadata carries every D-38 field", () => {
    expect(Object.keys(sampleScanResult.metadata).sort()).toEqual([
      "engine_commit_sha",
      "engine_version",
      "parse_errors_count",
      "parsed_files_count",
      "rule_pack_content_hash",
      "rule_pack_version",
      "scanned_at",
      "total_files_count",
    ]);
  });

  it("WebhookHandler carries every D-36 field", () => {
    expect(Object.keys(sampleHandler).sort()).toEqual([
      "evidence",
      "file_path",
      "findings_ref",
      "framework",
      "framework_version",
      "handler_function_name",
      "http_methods",
      "id",
      "location",
      "middleware_chain",
      "provider",
      "reachable_symbols",
      "redacted_snippet",
      "route_pattern",
      "verification_state",
    ]);
  });

  it("Finding carries every ENGINE-04 field including primary_location_line_hash", () => {
    expect(sampleFinding.primary_location_line_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(["verified", "not-verified", "manual-review"]).toContain(sampleFinding.state);
  });

  it("RuleSet exposes providers + rules + predicates per D-03/D-28/D-33", () => {
    expect(sampleRuleSet.providers.stripe.secret_literal_prefix).toContain("whsec_");
    expect(typeof sampleRuleSet.predicates).toBe("object");
  });

  it("Config supplies caller-owned wall clock + git sha (engine purity D-01)", () => {
    expect(typeof sampleConfig.scanned_at).toBe("string");
    expect(sampleConfig.reachability_max_depth).toBeGreaterThan(0);
  });
});
