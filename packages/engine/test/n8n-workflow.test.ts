import { describe, expect, it } from "vitest";
import { n8nAdapter } from "../src/adapters/n8n.js";
import { isN8nWorkflow, parseN8nWorkflow } from "../src/parsers/n8n-workflow.js";

// A minimal-but-real n8n workflow: one Webhook trigger node + one downstream AI Agent node,
// connected. Mirrors the RESEARCH "vulnerable.workflow.json" shape (no `authentication` key →
// default "none"). Indentation is significant: the range assertions below are computed against
// this exact string.
const VULNERABLE_WORKFLOW = `{
  "nodes": [
    {
      "parameters": { "httpMethod": "POST", "path": "agent-callback" },
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [250, 300]
    },
    {
      "parameters": {},
      "name": "AI Agent",
      "type": "@n8n/n8n-nodes-langchain.agent",
      "typeVersion": 1,
      "position": [500, 300]
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "AI Agent", "type": "main", "index": 0 }]] }
  }
}`;

// Mitigated: the Webhook node sets `authentication: "headerAuth"` and carries Header Auth creds.
const MITIGATED_WORKFLOW = `{
  "nodes": [
    {
      "parameters": { "httpMethod": "POST", "path": "agent-callback", "authentication": "headerAuth" },
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [250, 300],
      "credentials": { "httpHeaderAuth": { "id": "1", "name": "Header Auth" } }
    }
  ],
  "connections": { "Webhook": { "main": [[]] } }
}`;

describe("parseN8nWorkflow — position-aware parse", () => {
  it("parses a valid n8n workflow into a document with no parse error", () => {
    const result = parseN8nWorkflow(VULNERABLE_WORKFLOW, "workflow.json");
    expect(result.parseError).toBeNull();
    expect(result.document).not.toBeNull();
    expect(result.document?.nodes).toHaveLength(2);
    expect(result.file_path).toBe("workflow.json");
    expect(result.source_text).toBe(VULNERABLE_WORKFLOW);
  });

  it("returns a typed parse-error result for malformed JSON (never throws)", () => {
    const result = parseN8nWorkflow(`{ "nodes": [ }`, "broken.json");
    expect(result.document).toBeNull();
    expect(result.parseError).not.toBeNull();
    expect(result.parseError?.source).toBe("json");
    expect(typeof result.parseError?.message).toBe("string");
    expect(result.parseError?.location.line).toBeGreaterThanOrEqual(1);
    expect(result.parseError?.location.col).toBeGreaterThanOrEqual(1);
  });
});

describe("isN8nWorkflow — content sniff", () => {
  it("returns true for a real n8n workflow (nodes[] + connections + n8n-nodes-base. type)", () => {
    const result = parseN8nWorkflow(VULNERABLE_WORKFLOW, "workflow.json");
    expect(isN8nWorkflow(result.document)).toBe(true);
  });

  it("returns true when the only n8n-prefixed node uses @n8n/", () => {
    const result = parseN8nWorkflow(
      `{ "nodes": [ { "type": "@n8n/n8n-nodes-langchain.agent" } ], "connections": {} }`,
      "w.json",
    );
    expect(isN8nWorkflow(result.document)).toBe(true);
  });

  it("returns false for plain JSON config ({\"name\":\"x\"})", () => {
    const result = parseN8nWorkflow(`{ "name": "x" }`, "config.json");
    expect(isN8nWorkflow(result.document)).toBe(false);
  });

  it("returns false for a top-level JSON array", () => {
    const result = parseN8nWorkflow(`[1, 2, 3]`, "arr.json");
    expect(isN8nWorkflow(result.document)).toBe(false);
  });

  it("returns false when nodes lack n8n type prefixes", () => {
    const result = parseN8nWorkflow(
      `{ "nodes": [ { "type": "custom.thing" } ], "connections": {} }`,
      "notn8n.json",
    );
    expect(isN8nWorkflow(result.document)).toBe(false);
  });

  it("returns false when connections is absent even if nodes have n8n types", () => {
    const result = parseN8nWorkflow(
      `{ "nodes": [ { "type": "n8n-nodes-base.webhook" } ] }`,
      "noconn.json",
    );
    expect(isN8nWorkflow(result.document)).toBe(false);
  });

  it("returns false for a malformed (null document) parse result", () => {
    const result = parseN8nWorkflow(`{ "nodes": [ }`, "broken.json");
    expect(isN8nWorkflow(result.document)).toBe(false);
  });
});

describe("parseN8nWorkflow — source ranges", () => {
  it("maps the Webhook node to its precise JSON source range (not line 1)", () => {
    const result = parseN8nWorkflow(VULNERABLE_WORKFLOW, "workflow.json");
    const handlers = n8nAdapter(result);
    const webhook = handlers.find((h) => h.nodeName === "Webhook");
    expect(webhook).toBeDefined();
    // The Webhook node object opens at line 3 (1-indexed) in VULNERABLE_WORKFLOW.
    expect(webhook?.range.line).toBe(3);
    expect(webhook?.range.line).toBeGreaterThan(1); // Pitfall 7: never collapse to 1:1
    expect(webhook?.range.end_line).toBeGreaterThanOrEqual(webhook?.range.line ?? 0);
    expect(webhook?.range.col).toBeGreaterThanOrEqual(1);
  });
});

describe("n8nAdapter — node graph walk to synthetic handlers", () => {
  it("emits exactly one handler with authentication 'none' for an unauthenticated webhook trigger", () => {
    const result = parseN8nWorkflow(VULNERABLE_WORKFLOW, "workflow.json");
    const handlers = n8nAdapter(result);
    expect(handlers).toHaveLength(1);
    const h = handlers[0];
    expect(h?.provider).toBe("n8n");
    expect(h?.kind).toBe("n8n-webhook-trigger");
    expect(h?.attrs.authentication).toBe("none");
    expect(h?.attrs.nodeType).toBe("n8n-nodes-base.webhook");
    expect(h?.attrs.httpMethod).toBe("POST");
    expect(h?.attrs.path).toBe("agent-callback");
    expect(h?.attrs.hasCredentials).toBe(false);
    expect(h?.range.line).toBeGreaterThan(1);
  });

  it("normalizes a present authentication value and detects credentials", () => {
    const result = parseN8nWorkflow(MITIGATED_WORKFLOW, "workflow.json");
    const handlers = n8nAdapter(result);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.attrs.authentication).toBe("headerAuth");
    expect(handlers[0]?.attrs.hasCredentials).toBe(true);
  });

  it("produces zero handlers for non-trigger nodes", () => {
    const result = parseN8nWorkflow(
      `{ "nodes": [ { "name": "Agent", "type": "@n8n/n8n-nodes-langchain.agent" } ], "connections": {} }`,
      "w.json",
    );
    const handlers = n8nAdapter(result);
    expect(handlers).toHaveLength(0);
  });

  it("matches a webhook node by /webhook/i type even without the exact base type", () => {
    const result = parseN8nWorkflow(
      `{ "nodes": [ { "name": "WH", "type": "n8n-nodes-base.respondToWebhook" } ], "connections": {} }`,
      "w.json",
    );
    // respondToWebhook is a webhook-ish node; it matches /webhook/i.
    const handlers = n8nAdapter(result);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.attrs.authentication).toBe("none");
  });

  it("emits a handler regardless of typeVersion (1, 2, 2.1) — must not key on typeVersion", () => {
    for (const v of ["1", "2", "2.1"]) {
      const result = parseN8nWorkflow(
        `{ "nodes": [ { "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": ${v} } ], "connections": {} }`,
        "w.json",
      );
      const handlers = n8nAdapter(result);
      expect(handlers, `typeVersion ${v}`).toHaveLength(1);
    }
  });

  it("returns no handlers when the parse result is a parse error", () => {
    const result = parseN8nWorkflow(`{ "nodes": [ }`, "broken.json");
    expect(n8nAdapter(result)).toHaveLength(0);
  });
});
