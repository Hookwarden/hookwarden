// ERS-01 — Cross-provider predicate for the verification-error-swallowed
// bug class. Detects `try { verify() } catch (e) { /* no terminator */ }`
// patterns where a verification SDK call throws on invalid signatures but
// the catch handler doesn't rethrow / return a non-success status / exit,
// so the handler proceeds with an unverified payload.
//
// Citation: Clerk JavaScript GHSA-9mp4-77wg-rwx9 (verification-error
// swallowing in `verifyWebhook`).
//
// Terminator detection covers:
//   ReturnStatement, ThrowStatement,
//   process.exit/abort calls,
//   Express `next(err)`,
//   Fastify `reply.code(4xx).send()`,
//   Hono `c.json(_, 4xx)`.
//
// AST nodes are typed as `unknown` and narrowed inline (sibling predicate
// convention — engine packages @babel/types but rules do not).
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";

// Minimal structural types — narrow what we actually inspect.
interface AstNode {
  readonly type: string;
}
interface SourceLocLike {
  readonly start?: { readonly line: number };
}
interface NodeWithLoc extends AstNode {
  readonly loc?: SourceLocLike | null;
}
interface CallExpressionLike extends AstNode {
  readonly type: "CallExpression";
  readonly callee: AstNode;
  readonly arguments: ReadonlyArray<AstNode>;
}
interface MemberExpressionLike extends AstNode {
  readonly type: "MemberExpression";
  readonly object: AstNode;
  readonly property: AstNode;
  readonly computed: boolean;
}
interface IdentifierLike extends AstNode {
  readonly type: "Identifier";
  readonly name: string;
}
interface NumericLiteralLike extends AstNode {
  readonly type: "NumericLiteral";
  readonly value: number;
}
interface TryStatementLike extends NodeWithLoc {
  readonly type: "TryStatement";
  readonly block: { readonly body: ReadonlyArray<AstNode> };
  readonly handler: CatchClauseLike | null;
}
interface CatchClauseLike extends AstNode {
  readonly type: "CatchClause";
  readonly body: { readonly body: ReadonlyArray<AstNode> };
}

export function createVerificationErrorSwallowedPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const file = model.parsed_files?.find((f) => f.file_path === handler.file_path);
    if (!file || file.dialect !== "babel") return null;
    const body = (file.raw_ast as { program?: { body?: AstNode[] } })?.program?.body;
    if (!Array.isArray(body)) return null;

    const verifyNames = new Set(catalog.sdk_verify_calls);
    const tries = collectTryStatements(body, handler);

    for (const tryStmt of tries) {
      if (!tryContainsVerifyCall(tryStmt, verifyNames)) continue;
      if (tryStmt.handler === null) continue;
      if (classifyCatchHandler(tryStmt.handler) === "terminated") continue;
      return "not-verified";
    }
    return null;
  };
}

function collectTryStatements(
  body: ReadonlyArray<AstNode>,
  handler: WebhookHandler,
): TryStatementLike[] {
  const out: TryStatementLike[] = [];
  const startLine = handler.location.line;
  const endLine = (handler.location as { end_line?: number }).end_line ?? Number.MAX_SAFE_INTEGER;
  const visit = (node: AstNode): void => {
    if (node.type === "TryStatement") {
      const ts = node as TryStatementLike;
      const nodeLine = ts.loc?.start?.line ?? 0;
      if (nodeLine >= startLine && nodeLine <= endLine) {
        out.push(ts);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) visit(item);
        }
      } else if (isAstNode(value)) {
        visit(value);
      }
    }
  };
  for (const stmt of body) visit(stmt);
  return out;
}

function isAstNode(v: unknown): v is AstNode {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    typeof (v as { type: unknown }).type === "string"
  );
}

function tryContainsVerifyCall(
  tryStmt: TryStatementLike,
  verifyNames: ReadonlySet<string>,
): boolean {
  let found = false;
  const visit = (n: AstNode): void => {
    if (found) return;
    if (n.type === "CallExpression") {
      const name = qualifiedCallName(n as CallExpressionLike);
      if (name !== null) {
        if (verifyNames.has(name)) {
          found = true;
          return;
        }
        for (const v of verifyNames) {
          if (name.endsWith(`.${v}`)) {
            found = true;
            return;
          }
        }
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const value = (n as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) visit(item);
        }
      } else if (isAstNode(value)) {
        visit(value);
      }
    }
  };
  for (const stmt of tryStmt.block.body) visit(stmt);
  return found;
}

type CatchClassification = "terminated" | "swallowed";

function classifyCatchHandler(handler: CatchClauseLike): CatchClassification {
  for (const stmt of handler.body.body) {
    if (isTerminator(stmt)) return "terminated";
  }
  return "swallowed";
}

function isTerminator(stmt: AstNode): boolean {
  if (stmt.type === "ReturnStatement") return true;
  if (stmt.type === "ThrowStatement") return true;
  if (stmt.type === "ExpressionStatement") {
    const expr = (stmt as unknown as { expression: AstNode }).expression;
    if (expr.type !== "CallExpression") return false;
    const call = expr as CallExpressionLike;
    const name = qualifiedCallName(call);
    if (name === "process.exit" || name === "process.abort") return true;
    if (name === "next") return true;
    if (isFastifyErrorReply(call)) return true;
    if (isHonoErrorJson(call)) return true;
  }
  return false;
}

// Detect a chained 4xx/5xx error response. Covers:
//   res.status(4xx).send(...)       Express (terminator)
//   res.status(4xx).json(...)       Express + Hono with res-shape
//   reply.code(4xx).send(...)       Fastify
//   reply.status(4xx).send(...)     Fastify
//   res.status(4xx)                 bare (some handlers use return res.status(4xx))
// The walk descends from the outer call's callee MEMBER expression inward,
// looking for any `.status(N)` or `.code(N)` call where N is a 4xx/5xx literal.
function isFastifyErrorReply(call: CallExpressionLike): boolean {
  // Start by inspecting THIS call itself — handles bare `res.status(401)` shape.
  if (isStatusOrCodeCall(call)) return true;
  // Then descend through the callee chain. The outer call's callee is a
  // MemberExpression; walk into its `.object` looking for a chained
  // CallExpression of shape <inner>.status(N) / <inner>.code(N).
  if (call.callee.type !== "MemberExpression") return false;
  let cursor: AstNode = (call.callee as MemberExpressionLike).object;
  while (cursor.type === "CallExpression") {
    const innerCall = cursor as CallExpressionLike;
    if (isStatusOrCodeCall(innerCall)) return true;
    if (innerCall.callee.type !== "MemberExpression") break;
    cursor = (innerCall.callee as MemberExpressionLike).object;
  }
  return false;
}

function isStatusOrCodeCall(call: CallExpressionLike): boolean {
  if (call.callee.type !== "MemberExpression") return false;
  const mem = call.callee as MemberExpressionLike;
  if (mem.property.type !== "Identifier") return false;
  const propName = (mem.property as IdentifierLike).name;
  if (propName !== "code" && propName !== "status") return false;
  const firstArg = call.arguments[0];
  if (firstArg === undefined || firstArg.type !== "NumericLiteral") return false;
  const status = (firstArg as NumericLiteralLike).value;
  return status >= 400 && status < 600;
}

function isHonoErrorJson(call: CallExpressionLike): boolean {
  if (call.callee.type !== "MemberExpression") return false;
  const mem = call.callee as MemberExpressionLike;
  if (mem.computed) return false;
  if (mem.property.type !== "Identifier") return false;
  if ((mem.property as IdentifierLike).name !== "json") return false;
  const arg2 = call.arguments[1];
  if (arg2 === undefined || arg2.type !== "NumericLiteral") return false;
  const status = (arg2 as NumericLiteralLike).value;
  return status >= 400 && status < 600;
}

function qualifiedCallName(call: CallExpressionLike): string | null {
  return calleeToString(call.callee);
}

function calleeToString(expr: AstNode): string | null {
  if (expr.type === "Identifier") return (expr as IdentifierLike).name;
  if (expr.type === "MemberExpression") {
    const mem = expr as MemberExpressionLike;
    if (mem.computed) return null;
    if (mem.property.type !== "Identifier") return null;
    const lhs = mem.object.type === "ThisExpression" ? "this" : calleeToString(mem.object);
    if (lhs === null) return null;
    return `${lhs}.${(mem.property as IdentifierLike).name}`;
  }
  return null;
}

// __test_only — exposes the catch classifier for direct unit testing.
// biome-ignore lint/style/useNamingConvention: __test_only is a deliberate test-export convention
export const __test_only = {
  classifyCatchHandler,
  isTerminator,
};
