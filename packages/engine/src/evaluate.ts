// Top-level evaluate(model, ruleSet, config) → Promise<ScanResult>.
// D-35 + D-29 + D-30 + D-38. Pure: no I/O.
//
// Producer of ScanResult.inventory — DISCOVERY-01 (engine portion). The inventory carries every
// field listed in D-36 (handler shape) and is internally consistent with findings + metadata.

import { buildParseErrorFinding } from "./evaluator/parse-error.js";
import { evaluateRulesForHandler } from "./evaluator/visit.js";
import type { Config } from "./types/config.js";
import type { Finding, Verdict } from "./types/finding.js";
import type { WebhookHandler } from "./types/handler.js";
import type { ProjectModel } from "./types/project-model.js";
import type { RuleSet } from "./types/rule-set.js";
import type { ScanMetadata, ScanResult } from "./types/scan-result.js";
import { ENGINE_VERSION } from "./version.js";

const VERDICT_RANK: Record<Verdict, number> = {
  verified: 0,
  "manual-review": 1,
  "not-verified": 2,
};

export async function evaluate(
  model: ProjectModel,
  ruleSet: RuleSet,
  config: Config,
): Promise<ScanResult> {
  const findings: Finding[] = [];

  // 1. Parse-error findings (D-27 + ENGINE-07) — exactly one per parse-error file, no rules run.
  let parseErrorsCount = 0;
  let parsedFilesCount = 0;
  for (const file of model.parsed_files) {
    if (file.parse_error !== null) {
      parseErrorsCount++;
      findings.push(await buildParseErrorFinding(file));
    } else {
      parsedFilesCount++;
    }
  }

  // 2. Per-handler rule evaluation. Update verification_state + findings_ref on each handler.
  // DISCOVERY-01: this loop is the producer of ScanResult.inventory.
  const inventory: WebhookHandler[] = [];
  for (const handler of model.handlers) {
    const out = await evaluateRulesForHandler({ handler, ruleSet, model });
    for (const f of out.findings) findings.push(f);
    // Pick the worst verdict including the existing manual-review baseline.
    const baseline: Verdict = handler.verification_state;
    const worst: Verdict =
      VERDICT_RANK[out.worst_state] >= VERDICT_RANK[baseline] ? out.worst_state : baseline;
    inventory.push({
      ...handler,
      verification_state: worst,
      findings_ref: out.findings_ref,
    });
  }

  // 3. Metadata (ENGINE-08, D-38).
  const metadata: ScanMetadata = {
    engine_version: ENGINE_VERSION,
    engine_commit_sha: config.engine_commit_sha,
    rule_pack_version: ruleSet.rule_pack_version,
    rule_pack_content_hash: await computeRulePackContentHash(ruleSet),
    scanned_at: config.scanned_at,
    parse_errors_count: parseErrorsCount,
    parsed_files_count: parsedFilesCount,
    total_files_count: config.total_files_count,
  };

  return { findings, inventory, metadata };
}

// Same canonicalization algorithm as @hookwarden/rules' computeContentHash. Engine re-implements
// here to avoid a runtime dependency on the rules package (D-23 — engine consumes RuleSet, not
// the rules package itself).
async function computeRulePackContentHash(ruleSet: RuleSet): Promise<string> {
  const rules = ruleSet.rules.map((r) => ({
    schema_version: ruleSet.schema_version,
    rule_id: r.rule_id,
    provider: r.provider,
    severity: r.severity,
    emits_state: r.emits_state,
    message: r.message,
    matcher: r.matcher,
    predicate: r.predicate_name,
    applies_to: r.applies_to,
  }));
  const payload = canonicalize({ providers: ruleSet.providers, rules });
  return sha256Hex(payload);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < view.length; i++) out += (view[i] ?? 0).toString(16).padStart(2, "0");
  return out;
}
