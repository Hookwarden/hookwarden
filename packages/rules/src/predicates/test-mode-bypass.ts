// BYP-01 — Test-mode-bypass predicate. Detects the pattern where a handler
// short-circuits on `process.env.NODE_ENV !== 'production'` (or similar
// dev-mode test) and returns a SUCCESS response BEFORE any verification
// runs. Attackers can spoof X-Forwarded-Whatever to trigger the bypass
// in production if NODE_ENV gets clobbered, OR the bypass ships
// unintentionally if the env var isn't set in prod.
//
// Detection rules:
//   1. Find an IfStatement near the top of the handler body.
//   2. The if's test references one of the dev-mode env var names below.
//   3. The if's consequent has a "success response" (res.json / res.send
//      with no error status, OR bare `return`) followed by no further work.
//   4. The IfStatement appears BEFORE any verification call.
//
// If all four hold, emit not-verified at HIGH severity. The 5-pattern
// taxonomy from PITFALLS.md flags only the structural bug shape; legitimate
// dev-mode patterns (debug-header, debug-log, extra-response, extra-error-log)
// are NOT short-circuiting → silent.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";

interface AstNode {
  readonly type: string;
}
interface NodeWithLoc extends AstNode {
  readonly loc?: { readonly start?: { readonly line: number } } | null;
}
interface IfStatementLike extends NodeWithLoc {
  readonly type: "IfStatement";
  readonly test: AstNode;
  readonly consequent: AstNode;
}
interface CallExpressionLike extends AstNode {
  readonly type: "CallExpression";
  readonly callee: AstNode;
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
const DEV_MODE_ENV_NAMES = new Set([
  "NODE_ENV",
  "SKIP_VERIFICATION",
  "SKIP_WEBHOOK_VERIFICATION",
  "BYPASS_WEBHOOK",
  "DISABLE_WEBHOOK_VERIFICATION",
  "STAGE",
  "ENVIRONMENT",
  "ENV",
]);

const RESPONSE_WRITE_METHODS = new Set(["json", "send", "end"]);

export function createTestModeBypassPredicate(
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
    const startLine = handler.location.line;
    const endLine = (handler.location as { end_line?: number }).end_line ?? Number.MAX_SAFE_INTEGER;

    // Find the line of the first verification call inside the handler scope.
    // If verification is not found OR appears AFTER a dev-mode bypass, the
    // bypass is the bug.
    let firstVerifyLine: number = Number.MAX_SAFE_INTEGER;
    const visit = (n: AstNode, onCall: (call: CallExpressionLike, line: number) => void): void => {
      if (n.type === "CallExpression") {
        const c = n as CallExpressionLike;
        const name = qualifiedCallName(c);
        if (name !== null) {
          for (const v of verifyNames) {
            if (name === v || name.endsWith(`.${v}`)) {
              const line = (n as NodeWithLoc).loc?.start?.line ?? 0;
              if (line >= startLine && line <= endLine) onCall(c, line);
            }
          }
        }
      }
      for (const key of Object.keys(n)) {
        if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
        const value = (n as unknown as Record<string, unknown>)[key];
        if (value === null || value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) if (isAstNode(item)) visit(item, onCall);
        } else if (isAstNode(value)) {
          visit(value, onCall);
        }
      }
    };
    for (const stmt of body) {
      visit(stmt, (_c, line) => {
        if (line < firstVerifyLine) firstVerifyLine = line;
      });
    }

    // Walk the body for dev-mode IfStatements positioned BEFORE the first verify.
    const ifs: IfStatementLike[] = [];
    const collectIfs = (n: AstNode): void => {
      if (n.type === "IfStatement") {
        const node = n as IfStatementLike;
        const line = (node as NodeWithLoc).loc?.start?.line ?? 0;
        if (line >= startLine && line <= endLine) ifs.push(node);
      }
      for (const key of Object.keys(n)) {
        if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
        const value = (n as unknown as Record<string, unknown>)[key];
        if (value === null || value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) if (isAstNode(item)) collectIfs(item);
        } else if (isAstNode(value)) {
          collectIfs(value);
        }
      }
    };
    for (const stmt of body) collectIfs(stmt);

    for (const ifsStmt of ifs) {
      const ifLine = (ifsStmt as NodeWithLoc).loc?.start?.line ?? Number.MAX_SAFE_INTEGER;
      if (ifLine >= firstVerifyLine) continue;
      if (!testReferencesDevMode(ifsStmt.test)) continue;
      if (!consequentIsSuccessShortCircuit(ifsStmt.consequent)) continue;
      // All checks pass — bypass shape confirmed.
      return "not-verified";
    }
    return null;
  };
}

function isAstNode(v: unknown): v is AstNode {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    typeof (v as { type: unknown }).type === "string"
  );
}

// Does the IfStatement.test reference any dev-mode env variable?
// Covers:
//   process.env.NODE_ENV !== 'production'
//   process.env.SKIP_VERIFICATION
//   process.env.NODE_ENV === 'development'
//   !process.env.NODE_ENV (and similar)
function testReferencesDevMode(test: AstNode): boolean {
  let found = false;
  const visit = (n: AstNode): void => {
    if (found) return;
    // process.env.X access
    if (n.type === "MemberExpression") {
      const mem = n as MemberExpressionLike;
      if (
        mem.object.type === "MemberExpression" &&
        !(mem.object as MemberExpressionLike).computed &&
        (mem.object as MemberExpressionLike).property.type === "Identifier" &&
        ((mem.object as MemberExpressionLike).property as IdentifierLike).name === "env" &&
        (mem.object as MemberExpressionLike).object.type === "Identifier" &&
        ((mem.object as MemberExpressionLike).object as IdentifierLike).name === "process" &&
        !mem.computed &&
        mem.property.type === "Identifier"
      ) {
        const envName = (mem.property as IdentifierLike).name;
        if (DEV_MODE_ENV_NAMES.has(envName)) {
          found = true;
          return;
        }
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const value = (n as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isAstNode(item)) visit(item);
      } else if (isAstNode(value)) {
        visit(value);
      }
    }
  };
  visit(test);
  return found;
}

// Does the consequent unconditionally return a success response (or bare return)?
function consequentIsSuccessShortCircuit(cons: AstNode): boolean {
  // BlockStatement: any top-level statement that's a successful early return
  if (cons.type === "BlockStatement") {
    const body = (cons as unknown as { body: AstNode[] }).body;
    for (const stmt of body) {
      if (isSuccessTerminator(stmt)) return true;
    }
    return false;
  }
  // Single-statement consequent (no braces): `if (X) res.json(...)`
  return isSuccessTerminator(cons);
}

function isSuccessTerminator(stmt: AstNode): boolean {
  if (stmt.type === "ReturnStatement") {
    // Bare `return;` or `return res.json(...)` — both are success short-circuits
    // (the handler proceeds no further). PITFALLS flags bare-return-only as
    // manual-review later; v0.7.0 treats both as not-verified for simplicity.
    return true;
  }
  if (stmt.type === "ExpressionStatement") {
    const expr = (stmt as unknown as { expression: AstNode }).expression;
    if (expr.type !== "CallExpression") return false;
    const call = expr as CallExpressionLike;
    // res.json(...) / res.send(...) / res.end()  — without a 4xx status chain
    if (call.callee.type !== "MemberExpression") return false;
    const mem = call.callee as MemberExpressionLike;
    if (mem.property.type !== "Identifier") return false;
    if (!RESPONSE_WRITE_METHODS.has((mem.property as IdentifierLike).name)) return false;
    // If the chain has a .status(4xx) / .code(4xx) below, this is NOT a success
    // short-circuit — auditor will see the 4xx and judge it intentional.
    let cursor: AstNode = mem.object;
    while (cursor.type === "CallExpression") {
      const inner = cursor as CallExpressionLike;
      if (inner.callee.type === "MemberExpression") {
        const innerMem = inner.callee as MemberExpressionLike;
        if (
          innerMem.property.type === "Identifier" &&
          ((innerMem.property as IdentifierLike).name === "status" ||
            (innerMem.property as IdentifierLike).name === "code")
        ) {
          return false; // 4xx chain — not a success short-circuit
        }
        cursor = innerMem.object;
      } else {
        break;
      }
    }
    return true;
  }
  return false;
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

// __test_only — exposes internals for unit tests.
// biome-ignore lint/style/useNamingConvention: __test_only is a deliberate test-export convention
export const __test_only = {
  testReferencesDevMode,
  consequentIsSuccessShortCircuit,
  DEV_MODE_ENV_NAMES,
};
