// n8n workflow-JSON ingestion types (Phase 24, AGENT-01).
//
// n8n `*.workflow.json` is the engine's first NON-AST input path. Unlike babel /
// tree-sitter parsers that produce a `ParsedFile` with a `raw_ast`, the n8n path is
// deterministic structured data: `JSON.parse` + a graph walk. These types model the
// position-aware parse result and the synthetic-handler descriptor that the n8n adapter
// emits, one per webhook/trigger node, for the existing evaluator → findings pipeline.
//
// Engine purity (D-01): no `fs`/`http`/`net`/`fetch`. Source ranges are computed by a
// zero-dep line-scan over the raw JSON text (no JSON-AST dependency — that would trip the
// purity gate). The caller hands us the source string; the engine never reads files (D-03).

import type { SourceLocation } from "./finding.ts";

// A single n8n node object as it appears in `workflow.json#nodes[]`. Fields are optional
// because exported workflows frequently omit default-valued params (e.g. `authentication`
// defaults to "none" and is dropped from the export). The walker normalizes the absences.
export interface N8nNode {
  readonly name?: string;
  readonly type?: string; // e.g. "n8n-nodes-base.webhook" | "@n8n/n8n-nodes-langchain.agent"
  readonly typeVersion?: number;
  readonly position?: ReadonlyArray<number>;
  readonly parameters?: {
    readonly authentication?: string; // "none" | "headerAuth" | "basicAuth" | "jwtAuth" | ...
    readonly httpMethod?: string;
    readonly path?: string;
    readonly options?: Record<string, unknown>;
    readonly [key: string]: unknown;
  };
  readonly credentials?: {
    readonly httpHeaderAuth?: unknown;
    readonly httpBasicAuth?: unknown;
    readonly jwtAuth?: unknown;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

// The shape `JSON.parse` produces for an n8n workflow. `connections` is intentionally
// loose (n8n uses an object keyed by node name; older exports occasionally use arrays).
export interface N8nWorkflowDocument {
  readonly nodes?: ReadonlyArray<N8nNode>;
  readonly connections?: Record<string, unknown> | ReadonlyArray<unknown>;
  readonly [key: string]: unknown;
}

// A position-aware parse result. On success, `document` is the parsed tree and `parseError`
// is null. On malformed JSON, `document` is null and `parseError` carries a typed record —
// the engine NEVER throws-and-swallows; a parse error surfaces as a finding downstream
// (mirrors the babel/tree-sitter ParseErrorRecord contract).
export interface N8nParseResult {
  readonly file_path: string;
  readonly source_text: string;
  readonly document: N8nWorkflowDocument | null;
  readonly parseError: N8nParseError | null;
}

// Typed malformed-JSON record (parallels project-model ParseErrorRecord). `source: "json"`
// distinguishes it from the babel/tree-sitter parse-error sources.
export interface N8nParseError {
  readonly message: string;
  readonly location: { readonly line: number; readonly col: number };
  readonly source: "json";
}

// The attribute contract carried by each synthetic handler. Mirrors the RESEARCH OQ1 shape;
// `authentication` is normalized so a MISSING key collapses to "none" (n8n's UI default and
// the most common vulnerable export shape — Pitfall 1).
export interface N8nSyntheticHandlerAttrs {
  readonly nodeType: string;
  readonly typeVersion: number | null;
  readonly authentication: string; // missing → "none"
  readonly httpMethod: string | null;
  readonly path: string | null;
  readonly hasCredentials: boolean;
  readonly options: Record<string, unknown>;
}

// One synthetic handler per webhook/trigger node. This is a pre-assembly descriptor: the
// model-wiring plan (24-03) lifts it into a full `WebhookHandler` (carrying the attrs as
// `n8n_node_param` evidence) WITHOUT running the AST overlays in `assembleHandler` (it has
// no AST). The `range` is the node object's precise JSON source location (SC#1).
export interface N8nSyntheticHandler {
  readonly provider: "n8n";
  readonly kind: "n8n-webhook-trigger";
  readonly file: string;
  readonly nodeName: string | null;
  readonly range: SourceLocation;
  readonly attrs: N8nSyntheticHandlerAttrs;
}
