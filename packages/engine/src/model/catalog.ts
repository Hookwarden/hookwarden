// Catalog-driven framework detection (D-31). Covers the four frameworks the catalog data
// can express uniformly. Next.js / Django / FastAPI need bespoke adapters in Plan 07.
//
// This module produces "candidate handlers" — partial WebhookHandler shapes — that Plan 06b's
// build.ts enriches with cross-file data (reachable_symbols, middleware_chain) and evidence.

import type { Expression, File, Node, ObjectExpression } from "@babel/types";
import { walkBabelAst } from "../parsers/walk.js";
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

// Tree-sitter SyntaxNode — engine declares its own structural type to avoid coupling
// the model layer to web-tree-sitter's exported types.
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

const BODY_METHODS: ReadonlySet<string> = new Set(["post", "put", "patch", "delete", "all"]);
const ALL_METHODS: ReadonlySet<string> = new Set([
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

  walkBabelAst(ast, (node) => {
    const handler = matchAppMethodCall(node, parsedFile.file_path, hasHono, hasFastify);
    if (handler !== null) out.push(handler);

    if (hasFastify) {
      const fastifyRoute = matchFastifyRouteCall(node, parsedFile.file_path);
      if (fastifyRoute !== null) out.push(fastifyRoute);
    }
  });
  return out;
}

// Matches `app.METHOD(path, ...handlers)` for body-bearing methods (POST/PUT/PATCH/DELETE/ALL).
// Returns null when the node shape does not match — keeps the walker visitor side-effect-free.
function matchAppMethodCall(
  node: Node,
  filePath: string,
  hasHono: boolean,
  hasFastify: boolean,
): CandidateHandler | null {
  if (node.type !== "ExpressionStatement") return null;
  const expr = node.expression;
  if (expr.type !== "CallExpression") return null;
  const callee = expr.callee;
  if (callee.type !== "MemberExpression") return null;
  const property = callee.property;
  if (property.type !== "Identifier") return null;
  const methodName = property.name.toLowerCase();
  if (!ALL_METHODS.has(methodName) || !BODY_METHODS.has(methodName)) return null;

  const args = expr.arguments;
  const pathArg = args[0];
  if (!pathArg) return null;
  const path = extractStringPath(pathArg);
  if (path === null || !isWebhookishPath(path)) return null;

  const fnNode = args[args.length - 1];
  if (!fnNode || fnNode.type === "SpreadElement" || fnNode.type === "ArgumentPlaceholder") {
    return null;
  }

  const framework: Framework = hasHono ? "hono" : hasFastify ? "fastify" : "express";
  const fnSpan = spanOf(fnNode);
  return {
    framework,
    framework_version: null, // D-01 — never inferred in Phase 2 (issue #5).
    route_pattern: path,
    http_methods: [methodName.toUpperCase()],
    file_path: filePath,
    location: locationOf(node),
    handler_function_name: extractFunctionName(fnNode),
    handler_body_node: fnNode,
    handler_source_start: fnSpan.start,
    handler_source_end: fnSpan.end,
  };
}

// Matches `fastify.route({ method, url, handler })` shape.
function matchFastifyRouteCall(node: Node, filePath: string): CandidateHandler | null {
  if (node.type !== "ExpressionStatement") return null;
  const expr = node.expression;
  if (expr.type !== "CallExpression") return null;
  const callee = expr.callee;
  if (callee.type !== "MemberExpression") return null;
  const property = callee.property;
  if (property.type !== "Identifier" || property.name !== "route") return null;

  const opts = expr.arguments[0];
  if (!opts || opts.type !== "ObjectExpression") return null;

  const route = readRouteOptions(opts);
  const method = readMethodField(route.method);
  const url = route.url;
  if (!method || !url || !isWebhookishPath(url)) return null;
  if (!route.handler) return null;

  const fnSpan = spanOf(route.handler);
  return {
    framework: "fastify",
    framework_version: null, // issue #5
    route_pattern: url,
    http_methods: method,
    file_path: filePath,
    location: locationOf(node),
    handler_function_name: extractFunctionName(route.handler),
    handler_body_node: route.handler,
    handler_source_start: fnSpan.start,
    handler_source_end: fnSpan.end,
  };
}

// Typed result of reading a `fastify.route({ ... })` options object. The plan's earlier shape
// stuffed the handler node into a magic `__handler_node__` key; this struct types it directly.
interface FastifyRouteOptions {
  readonly method: string | ReadonlyArray<string> | null;
  readonly url: string | null;
  readonly handler: Expression | null;
}

function readRouteOptions(node: ObjectExpression): FastifyRouteOptions {
  let method: string | ReadonlyArray<string> | null = null;
  let url: string | null = null;
  let handler: Expression | null = null;
  for (const prop of node.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const keyName = propertyKeyName(prop.key);
    if (keyName === null) continue;
    const value = prop.value;
    if (keyName === "method") {
      if (value.type === "StringLiteral") {
        method = value.value;
      } else if (value.type === "ArrayExpression") {
        method = value.elements
          .filter(
            (e): e is Extract<NonNullable<typeof e>, { type: "StringLiteral" }> =>
              e !== null && e.type === "StringLiteral",
          )
          .map((e) => e.value);
      }
    } else if (keyName === "url") {
      if (value.type === "StringLiteral") url = value.value;
    } else if (keyName === "handler") {
      // Skip Pattern (destructuring assignment LHS) — only Expression-shaped values can be a handler.
      if (
        value.type !== "RestElement" &&
        value.type !== "AssignmentPattern" &&
        value.type !== "ArrayPattern" &&
        value.type !== "ObjectPattern"
      ) {
        handler = value as Expression;
      }
    }
  }
  return { method, url, handler };
}

function propertyKeyName(
  key: import("@babel/types").Expression | import("@babel/types").PrivateName,
): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  return null;
}

function extractStringPath(node: Node): string | null {
  if (node.type === "StringLiteral") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function isWebhookishPath(path: string): boolean {
  // Pre-filter: catch obvious webhook paths and conventional provider paths.
  // The catalog's `conventional_paths` is also used for evidence; the prefilter is just to keep
  // noise low so we don't enumerate every route in the project.
  const lower = path.toLowerCase();
  return lower.includes("webhook") || lower.includes("/hook") || lower.includes("/hooks");
}

function extractFunctionName(node: Node): string | null {
  if (node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
    return node.id?.name ?? null;
  }
  if (node.type === "Identifier") return node.name;
  return null; // arrow function or anonymous
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

function spanOf(node: Node): { readonly start: number; readonly end: number } {
  return { start: node.start ?? 0, end: node.end ?? 0 };
}

function readMethodField(
  value: string | ReadonlyArray<string> | null,
): ReadonlyArray<string> | null {
  if (value === null) return null;
  if (typeof value === "string") {
    return BODY_METHODS.has(value.toLowerCase()) ? [value.toUpperCase()] : null;
  }
  const upper = value.map((v) => v.toUpperCase());
  return upper.some((m) => BODY_METHODS.has(m.toLowerCase())) ? upper : null;
}

// ---- Python: Flask ----

function detectPythonCatalog(parsedFile: ParsedFile): ReadonlyArray<CandidateHandler> {
  const tree = parsedFile.raw_ast as { rootNode: PySyntaxNode };
  const out: CandidateHandler[] = [];

  // Detect `@app.route('/x', methods=['POST'])\ndef fn(...)` — Flask convention.
  const decorated = tree.rootNode.descendantsOfType(["decorated_definition"]);
  for (const node of decorated) {
    const handler = matchFlaskDecorator(node, parsedFile.file_path);
    if (handler !== null) out.push(handler);
  }
  return out;
}

function matchFlaskDecorator(node: PySyntaxNode, filePath: string): CandidateHandler | null {
  const fnDef = node.namedChildren.find((c) => c.type === "function_definition");
  if (!fnDef) return null;

  for (const dec of node.descendantsOfType(["decorator"])) {
    const route = matchRouteDecorator(dec);
    if (!route) continue;
    if (!isWebhookishPath(route.path)) continue;
    if (!route.methods.some((m) => BODY_METHODS.has(m.toLowerCase()))) continue;

    return {
      framework: "flask",
      framework_version: null, // issue #5
      route_pattern: route.path,
      http_methods: route.methods,
      file_path: filePath,
      location: {
        line: node.startPosition.row + 1,
        col: node.startPosition.column + 1,
        end_line: node.endPosition.row + 1,
        end_col: node.endPosition.column + 1,
      },
      handler_function_name: fnDef.childForFieldName("name")?.text ?? null,
      handler_body_node: fnDef,
      handler_source_start: fnDef.startIndex,
      handler_source_end: fnDef.endIndex,
    };
  }
  return null;
}

interface FlaskRoute {
  readonly path: string;
  readonly methods: ReadonlyArray<string>;
}

function matchRouteDecorator(dec: PySyntaxNode): FlaskRoute | null {
  const call = dec.descendantsOfType(["call"])[0];
  if (!call) return null;
  if (!(call.childForFieldName("function")?.text ?? "").endsWith(".route")) return null;
  const args = call.childForFieldName("arguments");
  if (!args) return null;

  const pathArg = args.namedChildren.find((c) => c.type === "string");
  if (!pathArg) return null;
  const path = stripPyString(pathArg.text);

  const methods: string[] = [];
  for (const kw of args.namedChildren) {
    if (kw.type !== "keyword_argument") continue;
    if (kw.childForFieldName("name")?.text !== "methods") continue;
    const list = kw.childForFieldName("value");
    if (!list) continue;
    for (const elem of list.namedChildren) {
      if (elem.type === "string") methods.push(stripPyString(elem.text).toUpperCase());
    }
  }
  return { path, methods: methods.length > 0 ? methods : ["GET"] };
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
