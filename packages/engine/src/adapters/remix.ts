// Remix adapter: `app/routes/**` route modules whose `action` (or `loader`) export receives a Web
// Fetch API Request — the same shape as a Next.js App Router handler. Remix webhooks live in the
// `action` export (POST/PUT/PATCH/DELETE); `loader` is GET. Found scanning documenso, whose real
// Stripe webhook (apps/remix/app/routes/api+/stripe.webhook.ts) was previously invisible → 0
// handlers → a silent false-negative ("clean" on an app that has a webhook).
//
// Pure: AST traversal + path-string matching only (engine purity gate D-01 bans I/O imports).

import type { File, FunctionDeclaration, Node } from "@babel/types";
import type { CandidateHandler } from "../model/catalog.js";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

// A Remix route module lives under `app/routes/`. Match at path start or after a `/` so both
// repo-root (`app/routes/...`) and nested (`apps/remix/app/routes/...`) layouts work. `route.ts`
// files are excluded — those are Next.js App Router (handled by nextjsAdapter); Remix route files
// are named after the route segment, never `route.<ext>`.
const ROUTE_FILE_RE = /(?:^|\/)app\/routes\/(.+)\.(?:ts|tsx|js|jsx)$/;
// `action` handles body methods (POST/PUT/PATCH/DELETE); `loader` is GET. Webhooks are `action`.
const HANDLER_EXPORTS: ReadonlySet<string> = new Set(["action"]);

interface NamedFunctionExport {
  readonly name: string;
  readonly fnNode: Node;
}

export function remixAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "babel") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];
  const m = file.file_path.match(ROUTE_FILE_RE);
  if (!m?.[1]) return [];
  if (file.file_path.endsWith("/route.ts") || file.file_path.endsWith("/route.tsx")) return [];

  const routePattern = deriveRoute(m[1]);
  const ast = file.raw_ast as File;
  const out: CandidateHandler[] = [];

  for (const stmt of ast.program.body) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    for (const exported of collectNamedFunctionExports(stmt)) {
      if (!HANDLER_EXPORTS.has(exported.name)) continue;
      out.push(buildHandler(file, routePattern, exported));
    }
  }
  return out;
}

// Derive a route path from the Remix route-module segment (the part after `app/routes/`, minus
// extension). Handles the common remix-flat-routes + folder conventions well enough for the
// webhookish-path prefilter and conventional-path attribution (exact param shapes don't matter):
//   api+/stripe.webhook → /api/stripe/webhook   (`+` = route folder; `.` = segment separator)
//   webhooks.stripe     → /webhooks/stripe
//   users.$id           → /users/$id
// Pathless/layout segments (leading `_`) and the `_index` leaf are dropped.
function deriveRoute(segment: string): string {
  const parts = segment
    .split("/")
    .map((p) => p.replace(/\+$/, "")) // flat-routes route folder `api+` → `api`
    .flatMap((p) => p.split(".")) // `stripe.webhook` → ["stripe","webhook"]
    .filter((p) => p.length > 0 && p !== "_index" && !p.startsWith("_")); // drop layout/index
  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

// `export async function action(...)` and `export const action = (...) => {...}`.
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
  routePattern: string,
  exported: NamedFunctionExport,
): CandidateHandler {
  const span = spanOf(exported.fnNode);
  return {
    framework: "remix" as Framework,
    framework_version: null,
    route_pattern: routePattern,
    // `action` serves all non-GET methods; POST is the canonical webhook method and passes the
    // body-method gate the rules apply.
    http_methods: ["POST"],
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
