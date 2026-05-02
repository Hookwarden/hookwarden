// Per-handler rule visitor. Walks ruleSet.rules, applies matcher OR predicate per D-28,
// emits one Finding per (rule, handler) match per D-30 (engine never dedups; renderer rollups).

import { computeFindingId, computePrimaryLocationLineHash } from "../findings/fingerprint.js";
import type { Finding, FindingId, Verdict } from "../types/finding.js";
import type { WebhookHandler } from "../types/handler.js";
import type { ProjectModel } from "../types/project-model.js";
import type { RuleDefinition, RuleSet } from "../types/rule-set.js";
import { applyMatcher } from "./matchers.js";

const VERDICT_RANK: Record<Verdict, number> = {
  verified: 0,
  "manual-review": 1,
  "not-verified": 2,
};

export interface EvaluateForHandlerInput {
  readonly handler: WebhookHandler;
  readonly ruleSet: RuleSet;
  readonly model: ProjectModel;
}

export interface EvaluateForHandlerOutput {
  readonly findings: ReadonlyArray<Finding>;
  readonly findings_ref: ReadonlyArray<FindingId>;
  readonly worst_state: Verdict;
}

export async function evaluateRulesForHandler(
  input: EvaluateForHandlerInput,
): Promise<EvaluateForHandlerOutput> {
  const { handler, ruleSet, model } = input;
  const findings: Finding[] = [];
  const findings_ref: FindingId[] = [];
  let worst: Verdict = "verified"; // optimistic baseline; rules promote toward not-verified
  for (const rule of ruleSet.rules) {
    if (!ruleAppliesToFramework(rule, handler.framework)) continue;
    const verdict = await runRule(rule, handler, model, ruleSet);
    if (verdict === null) continue; // rule does not apply
    const finding = await buildFinding(rule, handler, verdict);
    findings.push(finding);
    findings_ref.push(finding.id);
    if (VERDICT_RANK[verdict] > VERDICT_RANK[worst]) worst = verdict;
  }
  return { findings, findings_ref, worst_state: worst };
}

function ruleAppliesToFramework(
  rule: RuleDefinition,
  framework: WebhookHandler["framework"],
): boolean {
  if (rule.applies_to === "all") return true;
  return rule.applies_to.includes(framework);
}

async function runRule(
  rule: RuleDefinition,
  handler: WebhookHandler,
  model: ProjectModel,
  ruleSet: RuleSet,
): Promise<Verdict | null> {
  // D-28: a rule may have a matcher, a predicate, or both. If both are present, BOTH must agree
  // (return same verdict) for the rule to fire — conservative. If only one is present, its
  // verdict is the rule's verdict. Unmatched rule → null.
  let matcherVerdict: Verdict | null = null;
  if (rule.matcher !== null) {
    matcherVerdict = applyMatcher({
      matcher: rule.matcher,
      handler,
      model,
      providers: ruleSet.providers,
      emits_state: rule.emits_state,
    });
  }
  let predicateVerdict: Verdict | null = null;
  if (rule.predicate_name !== null) {
    const fn = ruleSet.predicates[rule.predicate_name];
    if (fn) predicateVerdict = await fn(handler, model);
  }
  if (rule.matcher !== null && rule.predicate_name !== null) {
    if (matcherVerdict === null || predicateVerdict === null) return null;
    return matcherVerdict === predicateVerdict ? matcherVerdict : null;
  }
  return matcherVerdict ?? predicateVerdict;
}

async function buildFinding(
  rule: RuleDefinition,
  handler: WebhookHandler,
  verdict: Verdict,
): Promise<Finding> {
  const lineText = extractLineFromHandler(handler);
  const primary_location_line_hash = await computePrimaryLocationLineHash({
    rule_id: rule.rule_id,
    file_path: handler.file_path,
    node_kind: "WebhookHandler",
    line_text: lineText,
  });
  const id = await computeFindingId({
    rule_id: rule.rule_id,
    handler_id: handler.id,
    file_path: handler.file_path,
    primary_location_line_hash,
  });
  return {
    id,
    rule_id: rule.rule_id,
    provider: rule.provider,
    severity: rule.severity,
    state: verdict,
    file_path: handler.file_path,
    location: handler.location,
    snippet: handler.redacted_snippet,
    handler_id: handler.id,
    primary_location_line_hash,
    message: rule.message,
    metadata: { framework: handler.framework, route_pattern: handler.route_pattern },
  };
}

function extractLineFromHandler(handler: WebhookHandler): string {
  // First line of the handler's redacted snippet — sufficient for the SARIF-style fingerprint
  // (Plan 02's computePrimaryLocationLineHash normalizes whitespace before hashing).
  const firstNl = handler.redacted_snippet.indexOf("\n");
  return firstNl < 0 ? handler.redacted_snippet : handler.redacted_snippet.slice(0, firstNl);
}
