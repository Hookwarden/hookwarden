// D-31 bespoke adapter: Next.js App Router. Filesystem-derived routes + HTTP-method-named exports.
// Pure: AST traversal + path-string matching only — engine purity gate (D-01) bans I/O imports.

import type { File, FunctionDeclaration, Node } from "@babel/types";
import type { CandidateHandler } from "../model/catalog.js";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

// Match `app/...` at the start of the path or after a `/` separator, so both
// repo-root paths (`app/api/...`) and nested paths (`apps/web/app/api/...`) work.
const ROUTE_FILE_RE = /(?:^|\/)app\/(?:.+\/)?route\.(?:ts|tsx|js|jsx)$/;
const ROUTE_PATH_RE = /(?:^|\/)app\/(.+?)\/route\.(?:ts|tsx|js|jsx)$/;
const BODY_METHOD_NAMES: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface NamedFunctionExport {
  readonly name: string;
  readonly fnNode: Node;
}

export function nextjsAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "babel") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];
  if (!ROUTE_FILE_RE.test(file.file_path)) return [];

  const route_pattern = deriveRoute(file.file_path);
  const ast = file.raw_ast as File;
  const out: CandidateHandler[] = [];

  for (const stmt of ast.program.body) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    for (const exported of collectNamedFunctionExports(stmt)) {
      if (!BODY_METHOD_NAMES.has(exported.name)) continue;
      out.push(buildHandler(file, route_pattern, exported));
    }
  }
  return out;
}

function deriveRoute(filePath: string): string {
  // app/api/webhooks/stripe/route.ts → /api/webhooks/stripe
  const m = filePath.match(ROUTE_PATH_RE);
  if (!m || !m[1]) return "/";
  return `/${m[1]}`;
}

// Pull out `export function POST(...)` and `export const POST = ...` named function shapes.
function collectNamedFunctionExports(
  exp: import("@babel/types").ExportNamedDeclaration,
): ReadonlyArray<NamedFunctionExport> {
  const decl = exp.declaration;
  if (!decl) return [];
  if (decl.type === "FunctionDeclaration" && decl.id) {
    return [{ name: decl.id.name, fnNode: decl as FunctionDeclaration }];
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
  route_pattern: string,
  exported: NamedFunctionExport,
): CandidateHandler {
  const span = spanOf(exported.fnNode);
  return {
    framework: "nextjs" as Framework,
    framework_version: null, // D-01 — never inferred in Phase 2 (issue #5).
    route_pattern,
    http_methods: [exported.name],
    file_path: file.file_path,
    location: locationOf(exported.fnNode),
    handler_function_name: exported.name,
    handler_body_node: exported.fnNode,
    handler_source_start: span.start,
    handler_source_end: span.end,
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

function spanOf(node: Node): { readonly start: number; readonly end: number } {
  return { start: node.start ?? 0, end: node.end ?? 0 };
}
