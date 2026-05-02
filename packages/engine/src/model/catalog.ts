// Catalog-driven framework detection (D-31). Covers the four frameworks the catalog data
// can express uniformly. Next.js / Django / FastAPI need bespoke adapters in Plan 07.
//
// This module produces "candidate handlers" — partial WebhookHandler shapes — that Plan 06b's
// build.ts enriches with cross-file data (reachable_symbols, middleware_chain) and evidence.

import type { File, Node } from "@babel/types";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

export interface CandidateHandler {
  readonly framework: Framework;
  readonly framework_version: string | null; // ALWAYS null in Phase 2 — D-01 forbids fs reads.
  readonly route_pattern: string;
  readonly http_methods: ReadonlyArray<string>;
  readonly file_path: string;
  readonly location: SourceLocation;
  readonly handler_function_name: string | null;
  // The AST node of the handler function body — engine internals walk this for verification.
  readonly handler_body_node: unknown;
  // Source-text byte range of the handler — used for redacted_snippet computation by build.ts.
  readonly handler_source_start: number;
  readonly handler_source_end: number;
}

interface PySyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly children: ReadonlyArray<PySyntaxNode>;
  readonly namedChildren: ReadonlyArray<PySyntaxNode>;
  childForFieldName(name: string): PySyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<PySyntaxNode>;
}

const BODY_METHODS = new Set(["post", "put", "patch", "delete", "all"]);
const ALL_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "all",
]);

export function detectCatalogHandlers(parsedFile: ParsedFile): ReadonlyArray<CandidateHandler> {
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return [];
  if (parsedFile.dialect === "babel") return detectJsTsCatalog(parsedFile);
  if (parsedFile.dialect === "tree-sitter-python") return detectPythonCatalog(parsedFile);
  return [];
}

// ---- JS/TS: Express, Hono, Fastify ----

function detectJsTsCatalog(parsedFile: ParsedFile): ReadonlyArray<CandidateHandler> {
  const ast = parsedFile.raw_ast as File;
  const out: CandidateHandler[] = [];
  const imports = parsedFile.imports;
  const hasHono = imports.some((i) => i.to_module === "hono" || i.to_module.startsWith("hono/"));
  const hasFastify = imports.some((i) => i.to_module === "fastify");

  visitJsTs(ast as unknown as Node, (node) => {
    if (node.type !== "ExpressionStatement") return;
    const expr = (node as unknown as { expression?: Node }).expression;
    if (!expr || expr.type !== "CallExpression") return;
    const ce = expr as unknown as { callee?: Node; arguments?: ReadonlyArray<Node> };
    if (!ce.callee || ce.callee.type !== "MemberExpression") return;
    const memEx = ce.callee as unknown as { property?: Node; object?: Node };
    if (!memEx.property || memEx.property.type !== "Identifier") return;
    const methodName = (memEx.property as unknown as { name: string }).name.toLowerCase();
    if (!ALL_METHODS.has(methodName)) return;
    if (!BODY_METHODS.has(methodName)) return; // webhooks are body-bearing
    const args = ce.arguments ?? [];
    const pathArg = args[0];
    if (!pathArg) return;
    const path = extractStringPath(pathArg);
    if (path === null) return;
    if (!isWebhookishPath(path)) return; // pre-filter to keep noise low
    const fnNode = args[args.length - 1];
    if (!fnNode) return;
    const framework: Framework = hasHono ? "hono" : hasFastify ? "fastify" : "express";
    const fnSpan = spanOf(fnNode);
    out.push({
      framework,
      framework_version: null, // D-01 — never inferred in Phase 2 (issue #5).
      route_pattern: path,
      http_methods: [methodName.toUpperCase()],
      file_path: parsedFile.file_path,
      location: locationOf(node),
      handler_function_name: extractFunctionName(fnNode),
      handler_body_node: fnNode,
      handler_source_start: fnSpan.start,
      handler_source_end: fnSpan.end,
    });
  });

  // Fastify alternative: fastify.route({ method, url, handler })
  if (hasFastify) {
    visitJsTs(ast as unknown as Node, (node) => {
      if (node.type !== "ExpressionStatement") return;
      const expr = (node as unknown as { expression?: Node }).expression;
      if (!expr || expr.type !== "CallExpression") return;
      const ce = expr as unknown as { callee?: Node; arguments?: ReadonlyArray<Node> };
      if (!ce.callee || ce.callee.type !== "MemberExpression") return;
      const memEx = ce.callee as unknown as { property?: Node };
      if (!memEx.property || memEx.property.type !== "Identifier") return;
      if ((memEx.property as unknown as { name: string }).name !== "route") return;
      const opts = ce.arguments?.[0];
      if (!opts || opts.type !== "ObjectExpression") return;
      const route = readObject(opts);
      const method = readMethodField(route["method"]);
      const url = typeof route["url"] === "string" ? (route["url"] as string) : null;
      if (!method || !url || !isWebhookishPath(url)) return;
      const handlerNode = (route["__handler_node__"] as Node | undefined) ?? null;
      if (!handlerNode) return;
      const fnSpan = spanOf(handlerNode);
      out.push({
        framework: "fastify",
        framework_version: null, // issue #5
        route_pattern: url,
        http_methods: method,
        file_path: parsedFile.file_path,
        location: locationOf(node),
        handler_function_name: extractFunctionName(handlerNode),
        handler_body_node: handlerNode,
        handler_source_start: fnSpan.start,
        handler_source_end: fnSpan.end,
      });
    });
  }
  return out;
}

function visitJsTs(root: Node, visitor: (node: Node) => void): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    visitor(node);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const v = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            stack.push(item as Node);
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        stack.push(v as Node);
      }
    }
  }
}

function extractStringPath(node: Node): string | null {
  if (node.type === "StringLiteral") return (node as unknown as { value: string }).value;
  if (node.type === "TemplateLiteral") {
    const tl = node as unknown as {
      quasis: ReadonlyArray<{ value: { cooked: string } }>;
      expressions: ReadonlyArray<unknown>;
    };
    if (tl.expressions.length === 0 && tl.quasis.length === 1) {
      return tl.quasis[0]?.value.cooked ?? null;
    }
  }
  return null;
}

function isWebhookishPath(path: string): boolean {
  // Pre-filter: catch obvious webhook paths and conventional provider paths.
  // The catalog's `conventional_paths` is also used for evidence here; the prefilter is just
  // to keep noise low so we don't enumerate every route in the project.
  const lower = path.toLowerCase();
  return lower.includes("webhook") || lower.includes("/hook") || lower.includes("/hooks");
}

function extractFunctionName(node: Node): string | null {
  if (node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
    return (node as unknown as { id: { name: string } | null }).id?.name ?? null;
  }
  if (node.type === "Identifier") return (node as unknown as { name: string }).name;
  return null; // arrow function or anonymous
}

function locationOf(node: Node): SourceLocation {
  const loc = (
    node as unknown as {
      loc?: {
        start: { line: number; column: number };
        end: { line: number; column: number };
      };
    }
  ).loc;
  return {
    line: loc?.start.line ?? 1,
    col: (loc?.start.column ?? 0) + 1,
    end_line: loc?.end.line ?? 1,
    end_col: (loc?.end.column ?? 0) + 1,
  };
}

function spanOf(node: Node): { readonly start: number; readonly end: number } {
  const n = node as unknown as { start?: number | null; end?: number | null };
  return { start: n.start ?? 0, end: n.end ?? 0 };
}

function readMethodField(value: unknown): ReadonlyArray<string> | null {
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    return BODY_METHODS.has(value.toLowerCase()) ? [upper] : null;
  }
  if (Array.isArray(value)) {
    const upper = value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.toUpperCase());
    if (upper.some((m) => BODY_METHODS.has(m.toLowerCase()))) return upper;
    return null;
  }
  return null;
}

function readObject(node: Node): Record<string, unknown> {
  // Lightweight ObjectExpression reader — only literals + handler node reference.
  const properties = (node as unknown as { properties: ReadonlyArray<unknown> }).properties;
  const out: Record<string, unknown> = {};
  for (const prop of properties) {
    const p = prop as { key?: { name?: string; value?: string }; value?: Node };
    const keyName = p.key?.name ?? p.key?.value;
    if (!keyName || !p.value) continue;
    if (p.value.type === "StringLiteral") {
      out[keyName] = (p.value as unknown as { value: string }).value;
    } else if (p.value.type === "ArrayExpression") {
      const elements = (
        p.value as unknown as {
          elements: ReadonlyArray<{ type: string; value?: unknown }>;
        }
      ).elements;
      out[keyName] = elements
        .filter((e) => e.type === "StringLiteral")
        .map((e) => (e as unknown as { value: string }).value);
    }
    if (keyName === "handler") {
      out["__handler_node__"] = p.value;
    }
  }
  return out;
}

// ---- Python: Flask ----

function detectPythonCatalog(parsedFile: ParsedFile): ReadonlyArray<CandidateHandler> {
  const tree = parsedFile.raw_ast as { rootNode: PySyntaxNode };
  const out: CandidateHandler[] = [];

  // Detect `@app.route('/x', methods=['POST'])\ndef fn(...)` — Flask convention.
  const decorated = tree.rootNode.descendantsOfType(["decorated_definition"]);
  for (const node of decorated) {
    const decoratorNodes = node.descendantsOfType(["decorator"]);
    const fnDef = node.namedChildren.find((c) => c.type === "function_definition");
    if (!fnDef) continue;
    for (const dec of decoratorNodes) {
      const call = dec.descendantsOfType(["call"])[0];
      if (!call) continue;
      const fnText = call.childForFieldName("function")?.text ?? "";
      if (!fnText.endsWith(".route")) continue;
      const args = call.childForFieldName("arguments");
      if (!args) continue;
      const pathArg = args.namedChildren.find((c) => c.type === "string");
      if (!pathArg) continue;
      const path = stripPyString(pathArg.text);
      if (!isWebhookishPath(path)) continue;
      const methods: string[] = [];
      for (const kw of args.namedChildren) {
        if (kw.type !== "keyword_argument") continue;
        const kwName = kw.childForFieldName("name")?.text;
        if (kwName !== "methods") continue;
        const list = kw.childForFieldName("value");
        if (!list) continue;
        for (const elem of list.namedChildren) {
          if (elem.type === "string") methods.push(stripPyString(elem.text).toUpperCase());
        }
      }
      const finalMethods = methods.length > 0 ? methods : ["GET"];
      if (!finalMethods.some((m) => BODY_METHODS.has(m.toLowerCase()))) continue;
      const fnNameNode = fnDef.childForFieldName("name");
      out.push({
        framework: "flask",
        framework_version: null, // issue #5
        route_pattern: path,
        http_methods: finalMethods,
        file_path: parsedFile.file_path,
        location: {
          line: node.startPosition.row + 1,
          col: node.startPosition.column + 1,
          end_line: node.endPosition.row + 1,
          end_col: node.endPosition.column + 1,
        },
        handler_function_name: fnNameNode?.text ?? null,
        handler_body_node: fnDef,
        handler_source_start: fnDef.startIndex,
        handler_source_end: fnDef.endIndex,
      });
    }
  }
  return out;
}

function stripPyString(raw: string): string {
  let i = 0;
  while (i < raw.length && /[bBrRuUfF]/.test(raw[i] ?? "")) i++;
  const quoted = raw.slice(i);
  if (quoted.startsWith('"""') || quoted.startsWith("'''")) {
    return quoted.slice(3, quoted.length - 3);
  }
  if (quoted.startsWith('"') || quoted.startsWith("'")) {
    return quoted.slice(1, quoted.length - 1);
  }
  return quoted;
}
