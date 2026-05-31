// Phase 24 (AGENT-01) — n8n trigger-auth predicate tests.
//
// Detector #1 (`n8n/webhook-trigger-no-authentication`, critical) is a self-contained
// RulePredicate — NOT a matcher-union variant (see 24-02-PLAN corrected objective +
// 24-01-SUMMARY "predicate-not-matcher path confirmed"). It reads the synthetic n8n
// handler's `n8n_node_param` evidence (`detail` = "authentication=<value>") and fires on
// `authentication` absent or "none". Plan 01's adapter normalizes a MISSING `authentication`
// key to "none", so absent and literal "none" exercise the same fire path.
//
// These tests assert the predicate contract directly with hand-built WebhookHandler
// fixtures; the engine-side adapter/evidence emission is tested in @hookwarden/engine.

import type { WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { n8nTriggerNoAuthPredicate } from "../src/predicates/n8n-trigger-auth.js";

function makeHandler(overrides: Partial<WebhookHandler>): WebhookHandler {
  return {
    id: "h",
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

function authEvidence(value: string): WebhookHandler["evidence"][number] {
  return {
    kind: "n8n_node_param",
    provider: "n8n",
    location: { line: 3, col: 5, end_line: 9, end_col: 6 },
    detail: `authentication=${value}`,
  };
}

describe("n8n-trigger-auth predicate — fires (unauthenticated trigger)", () => {
  it("emits not-verified when authentication evidence is 'none'", async () => {
    const handler = makeHandler({ evidence: [authEvidence("none")] });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("emits not-verified when the authentication evidence is absent (adapter normalizes absent → none)", async () => {
    // No n8n_node_param evidence at all → treat as "none" (the most common vulnerable
    // export shape, Pitfall 1). Same fire path as literal "none".
    const handler = makeHandler({ evidence: [] });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("ignores non-authentication n8n_node_param evidence when deciding (still fires on none)", async () => {
    const handler = makeHandler({
      evidence: [
        {
          kind: "n8n_node_param",
          provider: "n8n",
          location: { line: 3, col: 5, end_line: 9, end_col: 6 },
          detail: "httpMethod=POST",
        },
        authEvidence("none"),
      ],
    });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBe("not-verified");
  });
});

describe("n8n-trigger-auth predicate — silent (mitigated / out-of-scope)", () => {
  it("returns null when authentication is 'headerAuth' (mitigated shape — SC#2)", async () => {
    const handler = makeHandler({ evidence: [authEvidence("headerAuth")] });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBeNull();
  });

  it("returns null for basicAuth and jwtAuth (any non-'none' configured auth clears)", async () => {
    expect(
      await n8nTriggerNoAuthPredicate(makeHandler({ evidence: [authEvidence("basicAuth")] }), {} as never),
    ).toBeNull();
    expect(
      await n8nTriggerNoAuthPredicate(makeHandler({ evidence: [authEvidence("jwtAuth")] }), {} as never),
    ).toBeNull();
  });

  it("returns null for a non-n8n provider handler (provider guard)", async () => {
    const handler = makeHandler({
      provider: "stripe",
      framework: "express",
      evidence: [authEvidence("none")],
    });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBeNull();
  });

  it("returns null when an n8n handler is on a non-n8n-workflow framework (framework guard)", async () => {
    // Detector #1 is scoped to the JSON-workflow synthetic handler. A TS custom-node
    // handler (detector #2's target) must not be caught by this predicate.
    const handler = makeHandler({
      framework: "express",
      evidence: [authEvidence("none")],
    });
    expect(await n8nTriggerNoAuthPredicate(handler, {} as never)).toBeNull();
  });
});
