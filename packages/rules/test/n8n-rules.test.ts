// Phase 24 Plan 04 (AGENT-01) — n8n rule-pack detector unit tests.
//
// Rule-level proof that BOTH n8n detectors fire on the Cisco Talos "n8n n8mare"
// vulnerable shapes and stay SILENT on the mitigated shapes (SC#1 fire + SC#2
// zero-FP, at the predicate/unit level). The end-to-end / filesystem-level proof
// (scan a real *.workflow.json + custom-node .ts and assert findings) lands in
// Plan 05.
//
// Convention: assert the predicate contract directly with hand-built WebhookHandler
// fixtures (the existing provider-test convention — see verify-after-side-effect.test.ts
// and predicates-n8n-trigger-auth.test.ts). These are the rule-level NEGATIVE tests
// (mitigated = zero) mandated by [[feedback_negative_tests_required]].
//
//   Detector #1 (n8n/webhook-trigger-no-authentication, critical) — n8nTriggerNoAuthPredicate
//     reads the JSON-workflow synthetic handler's `n8n_node_param` evidence.
//   Detector #2 (n8n/agent-tool-acts-on-unverified-payload, high) — reuses the VAS-01
//     `side_effect_before_verify` evidence machinery scoped to provider:n8n. The engine
//     emits that evidence when an agent/tool/LLM sink (n8n catalog sink list) runs on the
//     unverified body before any getHeaderData()-based verification; a pre-sink header
//     check produces no such evidence -> the predicate is silent.

import type { WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { ALL_PREDICATES } from "../src/predicates/index.js";
import { n8nTriggerNoAuthPredicate } from "../src/predicates/n8n-trigger-auth.js";

// ---------------------------------------------------------------------------
// Detector #1 — JSON-workflow synthetic handler (framework: n8n-workflow)
// ---------------------------------------------------------------------------

function makeTriggerHandler(overrides: Partial<WebhookHandler>): WebhookHandler {
  return {
    id: "trigger",
    framework: "n8n-workflow",
    framework_version: null,
    route_pattern: "/webhook/agent-callback",
    http_methods: ["POST"],
    file_path: "flows/agent.workflow.json",
    location: { line: 3, col: 5, end_line: 9, end_col: 6 },
    handler_function_name: null,
    provider: "n8n",
    verification_state: "not-verified",
    evidence: [],
    middleware_chain: [],
    reachable_symbols: [],
    findings_ref: [],
    redacted_snippet: "",
    ...overrides,
  };
}

function nodeParam(detail: string): WebhookHandler["evidence"][number] {
  return {
    kind: "n8n_node_param",
    provider: "n8n",
    location: { line: 3, col: 5, end_line: 9, end_col: 6 },
    detail,
  };
}

describe("n8n detector #1 — webhook-trigger-no-authentication", () => {
  it("fires (not-verified) on a Webhook trigger node with authentication absent", async () => {
    // Adapter normalizes the absent `authentication` key to "none" (Pitfall 1);
    // the predicate also treats missing evidence as "none". Either way → fires.
    const handler = makeTriggerHandler({
      evidence: [nodeParam("nodeType=n8n-nodes-base.webhook"), nodeParam("httpMethod=POST")],
    });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("fires (not-verified) on an explicit authentication=none trigger", async () => {
    const handler = makeTriggerHandler({ evidence: [nodeParam("authentication=none")] });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("is SILENT on the mitigated trigger (authentication=headerAuth + httpHeaderAuth credential) — SC#2", async () => {
    const handler = makeTriggerHandler({
      evidence: [nodeParam("authentication=headerAuth"), nodeParam("credential=httpHeaderAuth")],
    });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Detector #2 — TS custom-node handler (provider:n8n on a code framework)
// ---------------------------------------------------------------------------

function makeCustomNodeHandler(overrides: Partial<WebhookHandler>): WebhookHandler {
  return {
    id: "custom-node",
    framework: "express",
    framework_version: null,
    route_pattern: "/webhook",
    http_methods: ["POST"],
    file_path: "nodes/Agent/Agent.node.ts",
    location: { line: 12, col: 3, end_line: 20, end_col: 4 },
    handler_function_name: "webhook",
    provider: "n8n",
    verification_state: "manual-review",
    evidence: [],
    middleware_chain: [],
    reachable_symbols: [],
    findings_ref: [],
    redacted_snippet: "",
    ...overrides,
  };
}

function sideEffectBeforeVerify(detail: string): WebhookHandler["evidence"][number] {
  return {
    kind: "side_effect_before_verify",
    provider: "n8n",
    location: { line: 14, col: 5, end_line: 14, end_col: 40 },
    detail,
  };
}

describe("n8n detector #2 — agent-tool-acts-on-unverified-payload", () => {
  const detector2 = ALL_PREDICATES["n8n-agent-tool-acts-on-unverified-payload"];

  it("is registered under the rule's predicate key", () => {
    expect(detector2).toBeDefined();
  });

  it("fires when the webhook body reaches an agent/tool call with no header check", async () => {
    // getBodyData() -> chain.invoke(body) with no getHeaderData() guard: the engine's
    // side-effect classifier (n8n catalog sink list includes chain.invoke) emits
    // side_effect_before_verify. The predicate surfaces the high/manual-review finding.
    const handler = makeCustomNodeHandler({
      evidence: [sideEffectBeforeVerify("chain.invoke")],
    });
    expect(await detector2?.(handler, {} as never)).toBe("manual-review");
  });

  it("is SILENT on the mitigated handler that verifies the header before the agent call — SC#2", async () => {
    // The mitigated handler validates this.getHeaderData()['x-webhook-token'] BEFORE the
    // body reaches the agent sink. Verification-first => the engine emits NO
    // side_effect_before_verify evidence => the predicate returns null (zero findings).
    const handler = makeCustomNodeHandler({ evidence: [] });
    expect(await detector2?.(handler, {} as never)).toBeNull();
  });

  it("is SILENT when the side-effect evidence is mis-attributed to a different provider", async () => {
    // Cross-attribution guard: a non-n8n provider's side_effect_before_verify must not
    // trip the n8n detector.
    const handler = makeCustomNodeHandler({
      evidence: [
        {
          kind: "side_effect_before_verify",
          provider: "github",
          location: { line: 14, col: 5, end_line: 14, end_col: 40 },
          detail: "chain.invoke",
        },
      ],
    });
    expect(await detector2?.(handler, {} as never)).toBeNull();
  });
});
