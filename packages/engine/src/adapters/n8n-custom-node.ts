// Phase 24 (AGENT-01) bespoke adapter: n8n custom-node TypeScript handlers.
//
// An n8n community/custom node that receives a webhook implements the `webhook()` method of
// `INodeType` with a `this: IWebhookFunctions` receiver:
//
//   async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
//     const body = this.getBodyData();      // SOURCE — the unverified payload
//     const out  = await chain.invoke(body); // SINK — an agent/LLM call on that payload
//     ...
//   }
//
// This shape matches NONE of the engine's existing handler detectors (detectCatalogHandlers only
// recognizes Express `app.post(...)`, Fastify `route({...})`, Flask/Django/FastAPI/Laravel/Slim/
// Symfony shapes — RESEARCH Pitfall 2). Without this adapter, detector #2
// (`n8n/agent-tool-acts-on-unverified-payload`) fires on NOTHING end-to-end.
//
// The adapter is content-gated (never glob/path based): it only runs on a file that imports a
// canonical n8n node interface (IWebhookFunctions / INodeType / INodeTypeDescription) from the
// `n8n-workflow` package — the same content sniff buildProjectModel uses to tag the file
// provider:n8n. The emitted CandidateHandler carries the `webhook` method node as
// `handler_body_node`, so the VAS-01 verify-ordering overlay in assembleHandler classifies the
// body→agent-sink dataflow. The framework is reported as `express` so the rule's
// `applies_to: [express, hono, fastify, nextjs]` scope matches once the handler is tagged
// provider:n8n (the rule is per-handler-provider, not per-framework).
//
// Pure: babel AST + ParsedFile only. No I/O (D-01).

import type { ClassMethod, File, Node, ObjectMethod } from "@babel/types";
import type { CandidateHandler } from "../model/catalog.js";
import { walkBabelAst } from "../parsers/walk.js";
import type { SourceLocation } from "../types/finding.js";
import type { ParsedFile } from "../types/project-model.js";

const N8N_NODE_INTERFACE_NAMES: ReadonlySet<string> = new Set([
  "INodeType",
  "IWebhookFunctions",
  "INodeTypeDescription",
]);

// True iff the file imports a recognized n8n node interface from `n8n-workflow`. Drift-tolerant:
// matches the module + any recognized interface name, never a specific package version.
function importsN8nNodeInterface(file: ParsedFile): boolean {
  for (const edge of file.imports) {
    if (edge.to_module !== "n8n-workflow") continue;
    for (const named of edge.imported_names) {
      if (N8N_NODE_INTERFACE_NAMES.has(named.source)) return true;
    }
  }
  return false;
}

function methodKeyName(node: ClassMethod | ObjectMethod): string | null {
  const key = node.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  return null;
}

function locationOf(node: Node): SourceLocation {
  const loc = node.loc;
  if (loc === null || loc === undefined) {
    return { line: 1, col: 0, end_line: 1, end_col: 1 };
  }
  return {
    line: loc.start.line,
    col: loc.start.column,
    end_line: loc.end.line,
    end_col: loc.end.column,
  };
}

/**
 * Detect n8n custom-node `webhook()` method handlers in a JS/TS file. Returns one
 * CandidateHandler per `webhook` method found in a file that imports an n8n node interface.
 */
export function n8nCustomNodeAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "babel") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];
  if (!importsN8nNodeInterface(file)) return [];

  const ast = file.raw_ast as File;
  const out: CandidateHandler[] = [];

  walkBabelAst(ast, (node) => {
    if (node.type !== "ClassMethod" && node.type !== "ObjectMethod") return;
    const method = node as ClassMethod | ObjectMethod;
    if (methodKeyName(method) !== "webhook") return;

    const start = typeof method.start === "number" ? method.start : 0;
    const end = typeof method.end === "number" ? method.end : start;
    out.push({
      framework: "express",
      framework_version: null,
      route_pattern: "/webhook",
      http_methods: ["POST"],
      file_path: file.file_path,
      location: locationOf(method),
      handler_function_name: "webhook",
      // The webhook method node — the verify-ordering overlay (handler-cfg.ts
      // extractTopLevelStatements) reaches its BlockStatement body for body→agent-sink ordering.
      handler_body_node: method,
      handler_source_start: start,
      handler_source_end: end,
    });
  });

  return out;
}
