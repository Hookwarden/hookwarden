// Phase 8.5 REACH-02 — edge-runtime route detection. Cloudflare Workers, Vercel Edge, and Deno expose
// webhook handlers through runtime entry points that have no framework router, so the catalog +
// bespoke adapters miss them today (COMPETITIVE-LANDSCAPE §4.5). This adapter detects the three shapes
// and emits a CandidateHandler each; downstream evidence/reachability (sdk_verify_call, raw-body) runs
// over the handler_body_node exactly as for any other framework, so the existing HMAC-over-raw-body
// rules evaluate (their applies_to now lists cloudflare-workers/vercel-edge/deno).
//
// Next.js App Router (`export const POST`) + Server Actions are already covered by nextjs.ts — NOT
// rebuilt here. Pure: AST traversal only (engine purity D-01).

import type { File, Node, ObjectExpression } from "@babel/types";
import type { CandidateHandler } from "../model/catalog.js";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

const HANDLER_EXPORT_NAMES: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "handler",
  "default",
]);

export function edgeRuntimeAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "babel" || file.parse_error !== null || file.raw_ast === null) return [];
  const ast = file.raw_ast as File;
  const out: CandidateHandler[] = [];

  const hasEdgeConfig = detectVercelEdgeConfig(ast);

  for (const stmt of ast.program.body) {
    // 1. Cloudflare Workers: `export default { async fetch(req) { ... } }`.
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration.type === "ObjectExpression") {
      const fetchFn = findFetchMethod(stmt.declaration);
      if (fetchFn) {
        out.push(buildHandler(file, "cloudflare-workers", "fetch", fetchFn));
        continue;
      }
    }

    // 2. Vercel Edge: a handler export in a module carrying `export const config = {runtime:'edge'}`.
    if (hasEdgeConfig && stmt.type === "ExportNamedDeclaration") {
      for (const exp of namedFunctionExports(stmt)) {
        if (HANDLER_EXPORT_NAMES.has(exp.name)) {
          out.push(buildHandler(file, "vercel-edge", exp.name, exp.fnNode));
        }
      }
    }
    if (
      hasEdgeConfig &&
      stmt.type === "ExportDefaultDeclaration" &&
      isFunctionNode(stmt.declaration)
    ) {
      out.push(buildHandler(file, "vercel-edge", "default", stmt.declaration));
    }

    // 3. Deno: top-level `Deno.serve(handler)` / `Deno.serve(opts, handler)` / `Deno.serve({fetch})`.
    const denoFn = denoServeHandler(stmt);
    if (denoFn) out.push(buildHandler(file, "deno", null, denoFn));
  }

  return out;
}

function isFunctionNode(node: Node): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

// `export const config = { runtime: 'edge' }` anywhere in the module.
function detectVercelEdgeConfig(ast: File): boolean {
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ExportNamedDeclaration" || stmt.declaration?.type !== "VariableDeclaration")
      continue;
    for (const decl of stmt.declaration.declarations) {
      if (decl.id.type !== "Identifier" || decl.id.name !== "config") continue;
      if (decl.init?.type !== "ObjectExpression") continue;
      for (const prop of decl.init.properties) {
        if (
          prop.type === "ObjectProperty" &&
          prop.key.type === "Identifier" &&
          prop.key.name === "runtime" &&
          prop.value.type === "StringLiteral" &&
          prop.value.value === "edge"
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

// The `fetch` method/property of a Workers default-export object.
function findFetchMethod(obj: ObjectExpression): Node | null {
  for (const prop of obj.properties) {
    if (
      prop.type === "ObjectMethod" &&
      prop.key.type === "Identifier" &&
      prop.key.name === "fetch"
    ) {
      return prop;
    }
    if (
      prop.type === "ObjectProperty" &&
      prop.key.type === "Identifier" &&
      prop.key.name === "fetch" &&
      isFunctionNode(prop.value as Node)
    ) {
      return prop.value as Node;
    }
  }
  return null;
}

// First function-valued argument of a top-level `Deno.serve(...)` call (also `Deno.serve({ fetch })`).
function denoServeHandler(stmt: Node): Node | null {
  const expr =
    stmt.type === "ExpressionStatement"
      ? stmt.expression
      : stmt.type === "VariableDeclaration"
        ? (stmt.declarations[0]?.init ?? null)
        : null;
  if (!expr || expr.type !== "CallExpression") return null;
  const callee = expr.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "Deno" ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "serve"
  )
    return null;
  for (const arg of expr.arguments) {
    if (isFunctionNode(arg as Node)) return arg as Node;
    // Deno.serve({ fetch(req){} }) form.
    if (arg.type === "ObjectExpression") {
      const fetchFn = findFetchMethod(arg);
      if (fetchFn) return fetchFn;
    }
  }
  return null;
}

interface NamedFunctionExport {
  readonly name: string;
  readonly fnNode: Node;
}

function namedFunctionExports(
  exp: import("@babel/types").ExportNamedDeclaration,
): ReadonlyArray<NamedFunctionExport> {
  const decl = exp.declaration;
  if (!decl) return [];
  if (decl.type === "FunctionDeclaration" && decl.id) {
    return [{ name: decl.id.name, fnNode: decl }];
  }
  if (decl.type === "VariableDeclaration") {
    const out: NamedFunctionExport[] = [];
    for (const v of decl.declarations) {
      if (v.id.type !== "Identifier" || !v.init) continue;
      out.push({ name: v.id.name, fnNode: v.init });
    }
    return out;
  }
  return [];
}

function buildHandler(
  file: ParsedFile,
  framework: Framework,
  fnName: string | null,
  fnNode: Node,
): CandidateHandler {
  return {
    framework,
    framework_version: null,
    route_pattern: "/", // edge runtimes have no static route; provider attribution comes from evidence
    http_methods: ["POST"],
    file_path: file.file_path,
    location: locationOf(fnNode),
    handler_function_name: fnName,
    handler_body_node: fnNode,
    handler_source_start: fnNode.start ?? 0,
    handler_source_end: fnNode.end ?? 0,
  };
}

function locationOf(node: Node): SourceLocation {
  const loc = node.loc;
  return {
    line: loc?.start.line ?? 1,
    col: (loc?.start.column ?? 0) + 1,
    end_line: loc?.end.line ?? 1,
    end_col: (loc?.end.column ?? 0) + 1,
  };
}
