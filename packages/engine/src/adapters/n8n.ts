// n8n adapter (Phase 24, AGENT-01). Consumes the position-aware parse from
// `parsers/n8n-workflow.ts` and walks `nodes[]`, emitting one synthetic-handler descriptor
// (`N8nSyntheticHandler`) per WEBHOOK/TRIGGER node.
//
// Scope (CONTEXT Decision 3): this adapter emits PRE-ASSEMBLY descriptors only. Lifting a
// descriptor into a full `WebhookHandler` (carrying the attrs as `n8n_node_param` evidence,
// bypassing the AST overlays) is the model-wiring plan (24-03). Cross-file workflow→handler
// dataflow correlation is a Deferred Idea (CONTEXT Decision 3) and is NOT implemented here.
//
// Trigger-node scope for the beta (RESEARCH OQ3): a node is a webhook trigger iff its `type`
// is `n8n-nodes-base.webhook` OR matches `/webhook/i`. We deliberately do NOT key on a
// specific `typeVersion` — that drifts across n8n majors (RESEARCH Pitfall, Task 2 behavior).
//
// Engine purity (D-01): pure function over the parse result. No I/O.

import { locateNodeRange } from "../parsers/n8n-workflow.js";
import type {
  N8nNode,
  N8nParseResult,
  N8nSyntheticHandler,
  N8nSyntheticHandlerAttrs,
} from "../types/n8n.js";

const WEBHOOK_TYPE = "n8n-nodes-base.webhook";
const WEBHOOK_TYPE_RE = /webhook/i;

/**
 * Walk an n8n workflow parse result and emit one synthetic handler per webhook/trigger node.
 * A parse-error result (or a non-n8n document) yields zero handlers.
 */
export function n8nAdapter(parsed: N8nParseResult): ReadonlyArray<N8nSyntheticHandler> {
  if (parsed.parseError !== null || parsed.document === null) return [];
  const nodes = parsed.document.nodes;
  if (!Array.isArray(nodes)) return [];

  const out: N8nSyntheticHandler[] = [];

  // Track per-anchor occurrence counts so two nodes that share a name (rare, but possible)
  // still resolve to distinct source ranges via locateNodeRange's `occurrenceIndex`.
  const anchorSeen = new Map<string, number>();

  for (const node of nodes) {
    const anchorKey = anchorFor(node);
    const occurrenceIndex = anchorKey !== null ? (anchorSeen.get(anchorKey) ?? 0) : 0;
    if (anchorKey !== null) anchorSeen.set(anchorKey, occurrenceIndex + 1);

    if (!isWebhookTriggerNode(node)) continue;

    out.push({
      provider: "n8n",
      kind: "n8n-webhook-trigger",
      file: parsed.file_path,
      nodeName: typeof node.name === "string" ? node.name : null,
      range: locateNodeRange(parsed.source_text, node, occurrenceIndex),
      attrs: attrsOf(node),
    });
  }

  return out;
}

// --- internals -------------------------------------------------------------

function isWebhookTriggerNode(node: N8nNode): boolean {
  const type = node.type;
  if (typeof type !== "string") return false;
  return type === WEBHOOK_TYPE || WEBHOOK_TYPE_RE.test(type);
}

/** The anchor string used by locateNodeRange, for occurrence-counting. */
function anchorFor(node: N8nNode): string | null {
  if (typeof node.name === "string" && node.name.length > 0) {
    return `"name": ${JSON.stringify(node.name)}`;
  }
  if (typeof node.type === "string") {
    return `"type": ${JSON.stringify(node.type)}`;
  }
  return null;
}

function attrsOf(node: N8nNode): N8nSyntheticHandlerAttrs {
  const parameters = node.parameters ?? {};
  const credentials = node.credentials ?? {};
  return {
    nodeType: typeof node.type === "string" ? node.type : "",
    typeVersion: typeof node.typeVersion === "number" ? node.typeVersion : null,
    // Pitfall 1: a MISSING `authentication` key normalizes to "none" (n8n's UI default and
    // the most common vulnerable export shape).
    authentication:
      typeof parameters.authentication === "string" ? parameters.authentication : "none",
    httpMethod: typeof parameters.httpMethod === "string" ? parameters.httpMethod : null,
    path: typeof parameters.path === "string" ? parameters.path : null,
    hasCredentials: Boolean(
      credentials.httpHeaderAuth || credentials.httpBasicAuth || credentials.jwtAuth,
    ),
    options:
      typeof parameters.options === "object" && parameters.options !== null
        ? (parameters.options as Record<string, unknown>)
        : {},
  };
}
