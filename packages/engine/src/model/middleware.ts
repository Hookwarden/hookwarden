// D-36 middleware_chain population. Express + Hono + Fastify covered.
// Flask middleware chains are decorator-based and rare on webhook routes; chain stays [] for v1
// (deferred per Plan 06b's known limitations; rule authors who need Flask middleware ordering
// can use a TS predicate via the D-28 escape hatch).

import type { File, Node } from "@babel/types";
import { walkBabelAst } from "../parsers/walk.js";
import type { SourceLocation } from "../types/finding.js";
import type { ResolvedMiddleware } from "../types/handler.js";
import type { ImportEdge, ParsedFile } from "../types/project-model.js";
import type { CandidateHandler } from "./catalog.js";

export interface ExtractMiddlewareInput {
  readonly handler: CandidateHandler;
  readonly parsedFile: ParsedFile;
  readonly imports: ReadonlyArray<ImportEdge>;
}

export function extractMiddlewareChain(
  input: ExtractMiddlewareInput,
): ReadonlyArray<ResolvedMiddleware> {
  const { handler, parsedFile, imports } = input;
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return [];
  // Decorator-based middleware on Python webhook handlers is rare; v1 leaves chain empty.
  // Phase 6 corpus run will surface whether this is actually needed; if so, lift to v1.x.
  if (
    handler.framework === "flask" ||
    handler.framework === "django" ||
    handler.framework === "fastapi"
  ) {
    return [];
  }
  if (parsedFile.dialect !== "babel") return [];

  const ast = parsedFile.raw_ast as File;
  const globalUses: ResolvedMiddleware[] = [];
  const routeArgs: ResolvedMiddleware[] = [];

  walkBabelAst(ast, (node) => {
    const useEntry = matchAppUseRegistration(node, handler, imports);
    if (useEntry) globalUses.push(useEntry);
    const routeMiddleware = matchRouteArgsMiddleware(node, handler, imports);
    routeArgs.push(...routeMiddleware);
  });

  // Final chain: global app.use(...) registrations (in source order) followed by per-route
  // middleware. Position is renumbered so the chain reads as "first middleware to run = position 0".
  const merged: ResolvedMiddleware[] = [];
  for (const m of [...globalUses, ...routeArgs]) {
    merged.push({ ...m, position: merged.length });
  }
  return merged;
}

// Match `app.use(...)` registrations registered before the handler's source location.
function matchAppUseRegistration(
  node: Node,
  handler: CandidateHandler,
  imports: ReadonlyArray<ImportEdge>,
): ResolvedMiddleware | null {
  if (node.type !== "ExpressionStatement") return null;
  const expr = node.expression;
  if (expr.type !== "CallExpression") return null;
  const callee = expr.callee;
  if (callee.type !== "MemberExpression") return null;
  if (callee.property.type !== "Identifier" || callee.property.name !== "use") return null;

  const loc = nodeLocation(node);
  if (loc.line >= handler.location.line) return null; // only middleware registered before the handler

  const arg = expr.arguments[0];
  if (!arg) return null;
  const name = identifierOrMemberName(arg);
  if (!name) return null;
  return {
    name,
    import_source: resolveImportSource(name, imports),
    position: 0, // renumbered after collection
    location: loc,
    preserves_raw_body: bodyParserPreservesRawBody(arg),
  };
}

// Match per-route middleware: `app.post('/x', mw1, mw2, handler)` — every CallExpression arg
// between the path (index 0) and handler (final) is middleware.
function matchRouteArgsMiddleware(
  node: Node,
  handler: CandidateHandler,
  imports: ReadonlyArray<ImportEdge>,
): ReadonlyArray<ResolvedMiddleware> {
  if (node.type !== "ExpressionStatement") return [];
  const expr = node.expression;
  if (expr.type !== "CallExpression") return [];
  const callee = expr.callee;
  if (callee.type !== "MemberExpression") return [];
  if (callee.property.type !== "Identifier") return [];
  if (expr.arguments.length < 3) return []; // need: path, ...middleware, handler

  // Match this call site to our handler by source location.
  const loc = nodeLocation(node);
  if (loc.line !== handler.location.line || loc.col !== handler.location.col) return [];

  const out: ResolvedMiddleware[] = [];
  // Middleware is args[1..args.length-2] (path is [0], handler is final).
  for (let i = 1; i < expr.arguments.length - 1; i++) {
    const arg = expr.arguments[i];
    if (!arg) continue;
    if (arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") continue;
    const name = identifierOrMemberName(arg);
    if (!name) continue;
    out.push({
      name,
      import_source: resolveImportSource(name, imports),
      position: i - 1, // renumbered after collection
      location: nodeLocation(arg),
      preserves_raw_body: bodyParserPreservesRawBody(arg),
    });
  }
  return out;
}

// True when `arg` is a body-parser call (`express.json(...)` / `bodyParser.json(...)`)
// configured with a `verify` hook — i.e. `express.json({ verify: (req, res, buf) => ... })`.
// A verify hook is the documented way to capture the raw bytes off the request (Stripe's
// own sample does exactly this), so the parser does NOT consume the raw body. We key on the
// presence of a `verify` function rather than tracing the assignment target, because adding
// `verify` to a JSON parser has effectively no purpose other than raw-body capture.
function bodyParserPreservesRawBody(arg: Node): boolean {
  if (arg.type !== "CallExpression") return false;
  const name = identifierOrMemberName(arg.callee);
  if (name !== "express.json" && name !== "bodyParser.json" && name !== "body-parser.json") {
    return false;
  }
  const options = arg.arguments[0];
  if (!options || options.type !== "ObjectExpression") return false;
  for (const prop of options.properties) {
    if (prop.type !== "ObjectProperty" && prop.type !== "ObjectMethod") continue;
    const key = prop.key;
    const keyName =
      key.type === "Identifier" ? key.name : key.type === "StringLiteral" ? key.value : null;
    if (keyName !== "verify") continue;
    if (prop.type === "ObjectMethod") return true;
    const value = prop.value;
    if (value.type === "ArrowFunctionExpression" || value.type === "FunctionExpression") {
      return true;
    }
  }
  return false;
}

function identifierOrMemberName(node: Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = identifierOrMemberName(node.object);
    if (obj && node.property.type === "Identifier") return `${obj}.${node.property.name}`;
    return null;
  }
  if (node.type === "CallExpression") {
    // e.g. `express.json()` — collapse to the callee chain.
    return identifierOrMemberName(node.callee);
  }
  return null;
}

function nodeLocation(node: Node): SourceLocation {
  const loc = node.loc;
  return {
    line: loc?.start.line ?? 1,
    col: (loc?.start.column ?? 0) + 1,
    end_line: loc?.end.line ?? 1,
    end_col: (loc?.end.column ?? 0) + 1,
  };
}

function resolveImportSource(
  qualifiedName: string,
  imports: ReadonlyArray<ImportEdge>,
): string | null {
  const root = qualifiedName.split(".")[0];
  if (!root) return null;
  for (const edge of imports) {
    for (const n of edge.imported_names) {
      if (n.local === root) return edge.to_module;
    }
  }
  return null;
}
