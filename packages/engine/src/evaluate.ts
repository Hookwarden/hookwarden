// Top-level evaluate(model, ruleSet, config) → Promise<ScanResult>.
// D-35 + D-29 + D-30 + D-38. Pure: no I/O.
//
// Producer of ScanResult.inventory — DISCOVERY-01 (engine portion). The inventory carries every
// field listed in D-36 (handler shape) and is internally consistent with findings + metadata.

import { buildParseErrorFinding } from "./evaluator/parse-error.js";
import { applyPathSeverityOverrides } from "./evaluator/path-severity-overrides.js";
import { evaluateRulesForHandler } from "./evaluator/visit.js";
import type { Config } from "./types/config.js";
import type { Finding, Verdict } from "./types/finding.js";
import type { WebhookHandler } from "./types/handler.js";
import type { ProjectModel } from "./types/project-model.js";
import type { RuleDefinition, RuleSet } from "./types/rule-set.js";
import type { ScanMetadata, ScanResult } from "./types/scan-result.js";
import { ENGINE_VERSION } from "./version.js";

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
  // D-57: build a rule_id → RuleDefinition lookup once per scan so each emitted finding can be
  // run through applyPathSeverityOverrides before being pushed onto findings[].
  const rulesById = new Map<string, RuleDefinition>();
  for (const r of ruleSet.rules) rulesById.set(r.rule_id, r);

  const inventory: WebhookHandler[] = [];
  for (const handler of model.handlers) {
    const out = await evaluateRulesForHandler({ handler, ruleSet, model });
    // Phase 8.5 REACH-01 — when the handler carries `queue_verification_reachable` evidence (it
    // enqueues the raw body and a verifying consumer is reachable), downgrade a `not-verified`
    // verdict to `manual-review`. The engine can't prove the consumer verifies the SAME payload
    // across the queue boundary, so the honest output is manual-review — never verified.
    const queueDeferred = handler.evidence.some((e) => e.kind === "queue_verification_reachable");
    for (const f of out.findings) {
      const rule = rulesById.get(f.rule_id);
      // D-57 path_severity_overrides applied post-emit; identity when rule has no overrides.
      const adjusted = rule ? applyPathSeverityOverrides(f, rule) : f;
      findings.push(maybeDowngradeQueueDeferred(adjusted, queueDeferred));
    }
    // Resolve the handler verdict. `out.worst_state` is optimistic ("verified") when no rule
    // fired, so it is only authoritative once at least one rule produced a verdict. With zero
    // findings the handler stays at the manual-review baseline (D-PITFALLS #3 — we confirmed
    // nothing). When rules DID fire, trust their aggregate: a `verified` verdict (e.g.
    // library-verified) now correctly resolves the handler to [verified] instead of being
    // pinned below the baseline by the old `max(worst, baseline)` rank comparison.
    const baseline: Verdict = handler.verification_state;
    let verdict: Verdict = out.findings.length > 0 ? out.worst_state : baseline;
    // Mirror the per-finding downgrade onto the handler verdict (REACH-01).
    if (queueDeferred && verdict === "not-verified") verdict = "manual-review";
    inventory.push({
      ...handler,
      verification_state: verdict,
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
    parse_candidates_count: 0, // D-64 placeholder — Plan 09 (cli/src/pipeline.ts) overrides with walker-derived count.
  };

  return { findings, inventory, metadata };
}

// Phase 8.5 REACH-01 — downgrade a not-verified finding to manual-review when the handler defers
// verification to a queue consumer. Annotates metadata so the CLI/JSON can explain the shift
// ("verification deferred to queue consumer — manual review"). Identity for any other state.
function maybeDowngradeQueueDeferred(finding: Finding, queueDeferred: boolean): Finding {
  if (!queueDeferred || finding.state !== "not-verified") return finding;
  return {
    ...finding,
    state: "manual-review",
    metadata: { ...finding.metadata, queue_verification_deferred: true },
  };
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
    // B-3: new RuleDefinition fields MUST be canonicalized — Phase 12 evidence-pack
    // export consumes this hash for reproducibility. Adding a field without updating
    // this function silently breaks the contract.
    provider_docs_url: r.provider_docs_url,
    path_severity_overrides: r.path_severity_overrides,
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
