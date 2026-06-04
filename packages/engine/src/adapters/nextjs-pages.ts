// Phase 29 (ENG-PAGES-01) bespoke adapter: Next.js PAGES Router (`pages/api/**`).
// Pure: AST traversal + path-string matching only — engine purity gate (D-01) bans I/O imports.
//
// Disjoint from the App Router adapter (nextjs.ts): that one matches `app/**/route.<ext>` and
// reads HTTP-method-named exports; this one matches `pages/api/**/<name>.<ext>` and reads the
// `export default` handler, inferring the method from a `req.method === "<M>"` guard (Pages Router
// handles every method in one default-exported function, gating internally). Both emit
// `framework: "nextjs"` CandidateHandlers; their path regexes never overlap, so a file is owned by
// exactly one adapter (no double-detection).

import type { File, Node } from "@babel/types";
import type { CandidateHandler } from "../model/catalog.js";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

// `pages/api/...` or `src/pages/api/...`, any nesting, any of the four JS/TS extensions.
const PAGES_API_FILE_RE = /(?:^|\/)(?:src\/)?pages\/api\/(?:.+\/)?[^/]+\.(?:ts|tsx|js|jsx)$/;
// Capture the route portion after `pages/api/` up to the extension.
const PAGES_API_ROUTE_RE = /(?:^|\/)(?:src\/)?pages\/api\/(.+?)\.(?:ts|tsx|js|jsx)$/;
const BODY_METHOD_NAMES: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HTTP_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

export function nextjsPagesAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "babel") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];
  if (!PAGES_API_FILE_RE.test(file.file_path)) return [];

  const ast = file.raw_ast as File;
  const handler = resolveDefaultExportHandler(ast);
  if (!handler) return [];

  const routePattern = derivePagesRoute(file.file_path);
  const methods = inferHttpMethods(handler.fnNode);
  return [buildHandler(file, routePattern, handler.fnNode, handler.name, methods)];
}

// `pages/api/stripe/webhook.ts` → `/api/stripe/webhook`
// `pages/api/webhooks/index.ts` → `/api/webhooks` (index collapses to its directory)
// `pages/api/[id]/hook.ts`      → `/api/[id]/hook` (dynamic segments kept verbatim)
function derivePagesRoute(filePath: string): string {
  const m = filePath.match(PAGES_API_ROUTE_RE);
  if (!m?.[1]) return "/api";
  const segments = m[1].split("/");
  if (segments[segments.length - 1] === "index") segments.pop();
  return segments.length === 0 ? "/api" : `/api/${segments.join("/")}`;
}

interface DefaultExportHandler {
  readonly name: string;
  readonly fnNode: Node;
}

// The handler is the `export default` value: a function declaration / arrow / function expression,
// an identifier resolving to a local function binding, or `export { handler as default }`.
function resolveDefaultExportHandler(ast: File): DefaultExportHandler | null {
  const localFns = collectLocalFunctionBindings(ast);
  for (const stmt of ast.program.body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (decl.type === "FunctionDeclaration") {
        return { name: decl.id?.name ?? "default", fnNode: decl };
      }
      if (decl.type === "ArrowFunctionExpression" || decl.type === "FunctionExpression") {
        return { name: "default", fnNode: decl };
      }
      if (decl.type === "Identifier") {
        const fn = localFns.get(decl.name);
        if (fn) return { name: decl.name, fnNode: fn };
      }
      return null;
    }
    // `export { handler as default }`
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration && !stmt.source) {
      for (const spec of stmt.specifiers) {
        if (spec.type !== "ExportSpecifier") continue;
        const exportedName =
          spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
        if (exportedName !== "default") continue;
        const fn = localFns.get(spec.local.name);
        if (fn) return { name: spec.local.name, fnNode: fn };
      }
    }
  }
  return null;
}

function collectLocalFunctionBindings(ast: File): ReadonlyMap<string, Node> {
  const map = new Map<string, Node>();
  for (const stmt of ast.program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      map.set(stmt.id.name, stmt);
    } else if (stmt.type === "VariableDeclaration") {
      for (const v of stmt.declarations) {
        if (v.id.type !== "Identifier" || !v.init) continue;
        if (v.init.type === "ArrowFunctionExpression" || v.init.type === "FunctionExpression") {
          map.set(v.id.name, v.init);
        }
      }
    }
  }
  return map;
}

// Infer which HTTP methods the handler services from `req.method === "<M>"` guards and
// `switch (req.method)` cases. Prefer body-bearing methods (a webhook is POST). With no guard at
// all, default to POST: webhooks are POST, and provider attribution — not the method — decides
// whether a finding is emitted, so a non-webhook page route still lands provider:"unknown".
function inferHttpMethods(fnNode: Node): ReadonlyArray<string> {
  const found = new Set<string>();
  walkNode(fnNode, (node) => {
    if (node.type === "BinaryExpression") {
      const ops = node.operator;
      if (ops === "===" || ops === "==" || ops === "!==" || ops === "!=") {
        const lit = methodStringFromComparison(node.left, node.right);
        if (lit) found.add(lit);
      }
    } else if (node.type === "SwitchStatement" && isReqMethodMember(node.discriminant)) {
      for (const c of node.cases) {
        if (c.test && c.test.type === "StringLiteral") {
          const v = c.test.value.toUpperCase();
          if (HTTP_METHODS.has(v)) found.add(v);
        }
      }
    }
  });
  if (found.size === 0) return ["POST"];
  const body = [...found].filter((m) => BODY_METHOD_NAMES.has(m)).sort();
  return body.length > 0 ? body : [...found].sort();
}

// `req.method === "POST"` in either operand order → "POST".
function methodStringFromComparison(left: Node, right: Node): string | null {
  const pairs: ReadonlyArray<readonly [Node, Node]> = [
    [left, right],
    [right, left],
  ];
  for (const [a, b] of pairs) {
    if (isReqMethodMember(a) && b.type === "StringLiteral") {
      const v = b.value.toUpperCase();
      if (HTTP_METHODS.has(v)) return v;
    }
  }
  return null;
}

// `req.method` / `request.method` / `event.req.method` — a member access whose property is
// `method` and whose object chain mentions a request-shaped identifier.
function isReqMethodMember(node: Node): boolean {
  if (node.type !== "MemberExpression") return false;
  if (node.computed) return false;
  if (node.property.type !== "Identifier" || node.property.name !== "method") return false;
  return identifierChainMentionsReq(node.object);
}

function identifierChainMentionsReq(node: Node): boolean {
  if (node.type === "Identifier") return /req|request/i.test(node.name);
  if (node.type === "MemberExpression") {
    if (node.property.type === "Identifier" && /req|request/i.test(node.property.name)) return true;
    return identifierChainMentionsReq(node.object);
  }
  return false;
}

// Minimal recursive AST walk over a node subtree (the handler fn). Visits every child node.
function walkNode(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object" && typeof (child as Node).type === "string") {
          walkNode(child as Node, visit);
        }
      }
    } else if (value && typeof value === "object" && typeof (value as Node).type === "string") {
      walkNode(value as Node, visit);
    }
  }
}

function buildHandler(
  file: ParsedFile,
  routePattern: string,
  fnNode: Node,
  name: string,
  methods: ReadonlyArray<string>,
): CandidateHandler {
  return {
    framework: "nextjs" as Framework,
    framework_version: null,
    route_pattern: routePattern,
    http_methods: [...methods],
    file_path: file.file_path,
    location: locationOf(fnNode),
    handler_function_name: name === "default" ? null : name,
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
