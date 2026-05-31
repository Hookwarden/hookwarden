// Phase 24 Plan 03 (AGENT-01) — content-driven n8n provider detection in the engine
// project-model path.
//
// Detection is combination-based (CONTEXT Decision 2):
//   (a) a *.workflow.json whose parsed content sniffs as n8n (isN8nWorkflow) → synthetic
//       n8n-webhook-trigger handlers lifted into the ProjectModel, carrying n8n_node_param
//       evidence (the binding contract Plan 24-02's predicate reads), OR
//   (b) a custom-node TS project signalled by package.json#n8n.nodes OR a source file
//       importing INodeType / IWebhookFunctions → TS handlers carry provider:n8n.
//
// Glob presence alone NEVER triggers a finding (FP moat — T-24-06). A random *.workflow.json
// that does not content-sniff as n8n, and non-n8n TS, both yield ZERO n8n handlers.

import { describe, expect, it } from "vitest";
import { buildProjectModel } from "../src/model/build.js";
import { parseJsTs } from "../src/parsers/babel.js";
import type { ParsedFile } from "../src/types/project-model.js";
import type { RuleSet } from "../src/types/rule-set.js";
import type { Config } from "../src/types/config.js";

const config: Config = {
  reachability_max_depth: 3,
  scanned_at: "2026-05-31T00:00:00.000Z",
  engine_commit_sha: null,
  total_files_count: 0,
};

const emptyRuleSet: RuleSet = {
  schema_version: 1,
  rule_pack_version: "test",
  providers: {},
  rules: [],
  predicates: {},
};

const N8N_WEBHOOK_NODE = "n8n-nodes-base.webhook";

// An n8n-shaped workflow with an unauthenticated Webhook trigger node (authentication absent).
const VULNERABLE_WORKFLOW = JSON.stringify(
  {
    nodes: [
      {
        parameters: { httpMethod: "POST", path: "agent-callback" },
        name: "Webhook",
        type: N8N_WEBHOOK_NODE,
        typeVersion: 2,
        position: [250, 300],
      },
      {
        parameters: {},
        name: "AI Agent",
        type: "@n8n/n8n-nodes-langchain.agent",
        typeVersion: 1,
        position: [500, 300],
      },
    ],
    connections: { Webhook: { main: [[{ node: "AI Agent", type: "main", index: 0 }]] } },
  },
  null,
  2,
);

// A JSON document that is NOT n8n-shaped (no n8n type prefixes, no connections in n8n form).
const NON_N8N_WORKFLOW = JSON.stringify(
  {
    nodes: [{ kind: "task", name: "deploy", run: "echo hi" }],
    stages: ["build", "deploy"],
  },
  null,
  2,
);

describe("Phase 24 Plan 03 — content-driven n8n detection", () => {
  it("routes an n8n-shaped *.workflow.json to >=1 n8n-webhook-trigger synthetic handler", async () => {
    const model = await buildProjectModel({
      parsedFiles: [],
      ruleSet: emptyRuleSet,
      config,
      workflowFiles: [{ file_path: "inbound.workflow.json", source_text: VULNERABLE_WORKFLOW }],
    });

    const n8nHandlers = model.handlers.filter((h) => h.provider === "n8n");
    expect(n8nHandlers.length).toBeGreaterThanOrEqual(1);

    const trigger = n8nHandlers[0]!;
    expect(trigger.framework).toBe("n8n-workflow");
    expect(trigger.file_path).toBe("inbound.workflow.json");
    // Precise JSON range (SC#1) — not collapsed to 1:1.
    expect(trigger.location.line).toBeGreaterThan(1);

    // Binding contract from 24-02: emit n8n_node_param evidence with detail "authentication=<value>".
    const authEvidence = trigger.evidence.find(
      (e) => e.kind === "n8n_node_param" && e.detail.startsWith("authentication="),
    );
    expect(authEvidence).toBeDefined();
    expect(authEvidence!.detail).toBe("authentication=none"); // absent key normalizes to none
  });

  it("tags a custom-node TS handler provider:n8n when the file imports IWebhookFunctions/INodeType", async () => {
    const ts = await parseJsTs({
      file_path: "src/VulnerableNode.node.ts",
      source_text:
        "import type { IWebhookFunctions, INodeType } from 'n8n-workflow';\n" +
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhook/agent-callback', (req, res) => { res.json(req.body); });\n",
    });

    const model = await buildProjectModel({
      parsedFiles: [ts],
      ruleSet: emptyRuleSet,
      config,
      customNodeSignal: true,
    });

    const handler = model.handlers[0];
    expect(handler).toBeDefined();
    expect(handler!.provider).toBe("n8n");
  });

  it("produces ZERO n8n handlers for a *.workflow.json that does not content-sniff as n8n", async () => {
    const model = await buildProjectModel({
      parsedFiles: [],
      ruleSet: emptyRuleSet,
      config,
      workflowFiles: [{ file_path: "config.workflow.json", source_text: NON_N8N_WORKFLOW }],
    });

    expect(model.handlers.filter((h) => h.provider === "n8n")).toHaveLength(0);
    expect(model.handlers).toHaveLength(0);
  });

  it("produces ZERO n8n handlers for an unrelated Express TS route (no n8n signal)", async () => {
    const ts: ParsedFile = await parseJsTs({
      file_path: "src/routes.ts",
      source_text:
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', (req, res) => { res.json(req.body); });\n",
    });

    const model = await buildProjectModel({
      parsedFiles: [ts],
      ruleSet: emptyRuleSet,
      config,
    });

    expect(model.handlers.filter((h) => h.provider === "n8n")).toHaveLength(0);
  });
});
