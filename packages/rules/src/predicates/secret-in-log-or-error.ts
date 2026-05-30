// LEAK-01 — Secret-in-log-or-error predicate. Provider-attributed leak
// detector. Walks the handler body for log/error sinks (console.*,
// logger.*, throw new Error) and inspects each argument for any identifier
// whose name appears in this provider's catalog `secret_env_prefix` list.
//
// Verdict mapping (matches the secret-identifier classifier's shape table):
//   - bare / template / concat / to-string / json  → not-verified HIGH
//   - slice(0, N ≤ 8)                              → manual-review
//   - boolean / length / hash / absent             → null (no finding)
//
// Why this matters: when an attacker compromises log storage (CloudWatch,
// Datadog, Sentry, etc.), they get every webhook secret too. The Sept 2025
// GitHub `X-Github-Encoded-Secret` incident is the canonical example. The
// rule fires even when the log is gated by `NODE_ENV !== 'production'` —
// the secret still ends up in source / CI artifacts.
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
interface NewExpressionLike extends AstNode {
  readonly type: "NewExpression";
  readonly callee: AstNode;
  readonly arguments: ReadonlyArray<AstNode>;
}
interface ThrowStatementLike extends AstNode {
  readonly type: "ThrowStatement";
  readonly argument: AstNode;
}

// Log sink object names we recognize.
const LOG_OBJECTS = new Set(["console", "logger", "log", "winston", "pino"]);
// Log sink method names.
const LOG_METHODS = new Set(["log", "error", "warn", "info", "debug", "trace", "fatal"]);
// Error constructor names.
const ERROR_CTORS = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError"]);

type Verdict = "not-verified" | "manual-review";

export function createSecretInLogOrErrorPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const file = model.parsed_files?.find((f) => f.file_path === handler.file_path);
    if (!file || file.dialect !== "babel") return null;
    const body = (file.raw_ast as { program?: { body?: AstNode[] } })?.program?.body;
    if (!Array.isArray(body)) return null;

    const secretNames = new Set<string>();
    for (const prefix of catalog.secret_env_prefix) {
      secretNames.add(prefix);
      // Conventional suffix variants (STRIPE_WEBHOOK → STRIPE_WEBHOOK_SECRET)
      secretNames.add(`${prefix}_SECRET`);
    }
    if (secretNames.size === 0) return null;

    const startLine = handler.location.line;
    const endLine = (handler.location as { end_line?: number }).end_line ?? Number.MAX_SAFE_INTEGER;

    let worstVerdict: Verdict | null = null;
    const upgrade = (v: Verdict): void => {
      if (v === "not-verified" || worstVerdict === null) {
        worstVerdict = v;
      }
    };

    const visit = (n: AstNode): void => {
      const line = (n as NodeWithLoc).loc?.start?.line ?? 0;
      if (line < startLine || line > endLine) {
        // Still need to recurse into containers above the handler that
        // may contain the handler subtree.
      }

      // throw new Error("..." + secret)
      if (n.type === "ThrowStatement") {
        const ts = n as ThrowStatementLike;
        const arg = ts.argument;
        if (arg.type === "NewExpression") {
          const ne = arg as NewExpressionLike;
          if (
            ne.callee.type === "Identifier" &&
            ERROR_CTORS.has((ne.callee as IdentifierLike).name)
          ) {
            for (const a of ne.arguments) {
              const v = classifyArgForAnySecret(a, secretNames);
              if (v !== null) upgrade(v);
            }
          }
        }
      }

      // console.<method>(...), logger.<method>(...), winston.<method>(...)
      if (n.type === "CallExpression") {
        const call = n as CallExpressionLike;
        if (
          call.callee.type === "MemberExpression" &&
          !(call.callee as MemberExpressionLike).computed
        ) {
          const mem = call.callee as MemberExpressionLike;
          if (
            mem.object.type === "Identifier" &&
            mem.property.type === "Identifier" &&
            LOG_OBJECTS.has((mem.object as IdentifierLike).name) &&
            LOG_METHODS.has((mem.property as IdentifierLike).name)
          ) {
            for (const a of call.arguments) {
              const v = classifyArgForAnySecret(a, secretNames);
              if (v !== null) upgrade(v);
            }
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
    for (const stmt of body) visit(stmt);
    return worstVerdict;
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

// Classify a single arg expression against ANY of the provider's secret
// identifier names. Returns the first non-silent verdict found.
function classifyArgForAnySecret(arg: AstNode, secretNames: ReadonlySet<string>): Verdict | null {
  for (const name of secretNames) {
    const shape = classifyShape(arg, name);
    if (shape === "fires") return "not-verified";
    if (shape === "manual-review") return "manual-review";
  }
  return null;
}

type ShapeVerdict = "fires" | "manual-review" | "silent";

// Mirror of @hookwarden/engine's secret-identifier classifier, scoped down
// to the rules-side AST narrowing. We could import directly from engine but
// engine doesn't currently export this helper, and inlining keeps rules
// purity-free of @babel/types.
function classifyShape(node: AstNode, secretName: string): ShapeVerdict {
  if (isSecretIdentifier(node, secretName)) return "fires";

  // Defensive wrappers — silent (hash / boolean / length)
  if (isHashWrapper(node, secretName)) return "silent";
  if (isBooleanWrapper(node, secretName)) return "silent";
  if (isLengthAccess(node, secretName)) return "silent";

  // Small slice → manual-review
  const sliceLen = sliceCallLength(node, secretName);
  if (sliceLen !== null) {
    return sliceLen <= 8 ? "manual-review" : "fires";
  }

  // Value-emitting wrappers
  if (isToStringCall(node, secretName)) return "fires";
  if (isJsonStringify(node, secretName)) return "fires";

  // TemplateLiteral — recurse expressions
  if (node.type === "TemplateLiteral") {
    const exprs = (node as unknown as { expressions: AstNode[] }).expressions;
    for (const e of exprs) {
      const inner = classifyShape(e, secretName);
      if (inner === "fires" || inner === "manual-review") return inner;
    }
  }
  // BinaryExpression + concat
  if (node.type === "BinaryExpression") {
    const be = node as unknown as { operator: string; left: AstNode; right: AstNode };
    if (be.operator === "+") {
      const l = classifyShape(be.left, secretName);
      const r = classifyShape(be.right, secretName);
      if (l === "fires" || r === "fires") return "fires";
      if (l === "manual-review" || r === "manual-review") return "manual-review";
    }
  }
  return "silent";
}

function isSecretIdentifier(node: AstNode, secretName: string): boolean {
  return node.type === "Identifier" && (node as IdentifierLike).name === secretName;
}

function isBooleanWrapper(node: AstNode, secretName: string): boolean {
  if (
    node.type === "UnaryExpression" &&
    (node as unknown as { operator: string; argument: AstNode }).operator === "!"
  ) {
    const inner = (node as unknown as { argument: AstNode }).argument;
    if (
      inner.type === "UnaryExpression" &&
      (inner as unknown as { operator: string; argument: AstNode }).operator === "!" &&
      isSecretIdentifier((inner as unknown as { argument: AstNode }).argument, secretName)
    ) {
      return true;
    }
  }
  if (node.type === "CallExpression") {
    const call = node as CallExpressionLike;
    if (
      call.callee.type === "Identifier" &&
      (call.callee as IdentifierLike).name === "Boolean" &&
      call.arguments.length === 1 &&
      isSecretIdentifier(call.arguments[0] as AstNode, secretName)
    ) {
      return true;
    }
  }
  return false;
}

function isLengthAccess(node: AstNode, secretName: string): boolean {
  if (node.type !== "MemberExpression") return false;
  const mem = node as MemberExpressionLike;
  return (
    !mem.computed &&
    mem.property.type === "Identifier" &&
    (mem.property as IdentifierLike).name === "length" &&
    isSecretIdentifier(mem.object, secretName)
  );
}

function sliceCallLength(node: AstNode, secretName: string): number | null {
  if (node.type !== "CallExpression") return null;
  const call = node as CallExpressionLike;
  if (call.callee.type !== "MemberExpression") return null;
  const mem = call.callee as MemberExpressionLike;
  if (mem.computed) return null;
  if (mem.property.type !== "Identifier") return null;
  const m = (mem.property as IdentifierLike).name;
  if (m !== "slice" && m !== "substring" && m !== "substr") return null;
  if (!isSecretIdentifier(mem.object, secretName)) return null;
  let max = 0;
  for (const a of call.arguments) {
    if (a.type === "NumericLiteral") {
      const v = (a as unknown as { value: number }).value;
      if (v > max) max = v;
    }
  }
  return max;
}

function isToStringCall(node: AstNode, secretName: string): boolean {
  if (node.type !== "CallExpression") return false;
  const call = node as CallExpressionLike;
  // identifier.toString()
  if (call.callee.type === "MemberExpression") {
    const mem = call.callee as MemberExpressionLike;
    if (
      !mem.computed &&
      mem.property.type === "Identifier" &&
      (mem.property as IdentifierLike).name === "toString" &&
      isSecretIdentifier(mem.object, secretName)
    ) {
      return true;
    }
  }
  // String(identifier)
  if (
    call.callee.type === "Identifier" &&
    (call.callee as IdentifierLike).name === "String" &&
    call.arguments.length >= 1 &&
    isSecretIdentifier(call.arguments[0] as AstNode, secretName)
  ) {
    return true;
  }
  return false;
}

function isJsonStringify(node: AstNode, secretName: string): boolean {
  if (node.type !== "CallExpression") return false;
  const call = node as CallExpressionLike;
  if (call.callee.type !== "MemberExpression") return false;
  const mem = call.callee as MemberExpressionLike;
  if (mem.computed) return false;
  if (
    mem.object.type !== "Identifier" ||
    (mem.object as IdentifierLike).name !== "JSON" ||
    mem.property.type !== "Identifier" ||
    (mem.property as IdentifierLike).name !== "stringify"
  ) {
    return false;
  }
  return call.arguments.some((a) => isSecretIdentifier(a as AstNode, secretName));
}

const HASH_HINTS = new Set([
  "sha1",
  "sha256",
  "sha512",
  "md5",
  "hash",
  "createHash",
  "createHmac",
  "digest",
  "hmac",
  "Hash",
  "Hmac",
]);

function isHashWrapper(node: AstNode, secretName: string): boolean {
  if (node.type !== "CallExpression") return false;
  const call = node as CallExpressionLike;
  const name = extractCalleeName(call.callee);
  if (name === null || !HASH_HINTS.has(name)) return false;
  return call.arguments.some((a) => isSecretIdentifier(a as AstNode, secretName));
}

function extractCalleeName(callee: AstNode): string | null {
  if (callee.type === "Identifier") return (callee as IdentifierLike).name;
  if (callee.type === "MemberExpression") {
    const mem = callee as MemberExpressionLike;
    if (!mem.computed && mem.property.type === "Identifier") {
      return (mem.property as IdentifierLike).name;
    }
  }
  return null;
}

// biome-ignore lint/style/useNamingConvention: __test_only is a deliberate test-export convention
export const __test_only = { classifyShape, LOG_OBJECTS, LOG_METHODS, ERROR_CTORS };
