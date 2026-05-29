// 08.3 Plan 17 — Stripe empty-secret bypass detector (CVE-2026-41432).
//
// CVE-2026-41432: passing an empty-string secret to `stripe.webhooks.constructEvent`
// silently succeeds — HMAC-SHA256 over an empty key matches any forged signature
// computed by the attacker with the same empty key. The vulnerability surfaces
// whenever the secret can be `''` at runtime.
//
// D-05 PARTIAL COVERAGE (Plan 17 ships JS/TS variants 1, 2, 3, 6;
// variants 4 + 5 + Python + PHP deferred to Plan 17b):
//
//   ✓ Variant 1: `secret || ''`                — LogicalExpression `||` with empty-string right
//   ✓ Variant 2: `secret ?? ''`                — LogicalExpression `??` with empty-string right
//   ✓ Variant 3: `secret ? secret : ''`        — ConditionalExpression with empty alternate/consequent
//   ✗ Variant 4: missing nullish guard          — requires control-flow analysis (Plan 17b)
//   ✗ Variant 5: optional chaining              — requires deeper data-flow trace (Plan 17b)
//   ✓ Variant 6: explicit empty string literal — StringLiteral("") directly at the secret arg
//
//   Python + PHP coverage deferred to Plan 17b (the CVE applies to all 3 languages but
//   the broad-pattern data-flow trace needs language-specific helpers in
//   _helpers-python.ts and _helpers-php.ts that don't exist yet).
//
// Variants 1, 2, 3, 6 fire INDEPENDENTLY — variant 6 (explicit literal) does NOT collapse
// into variants 1-3 (logical-OR / nullish / ternary fallbacks). Per D-05's correctness
// requirement, an empty StringLiteral at the secret arg position matches variant 6 even
// when the same call site has no fallback expression.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

// Structural Babel-node typing — the rules package cannot import @babel/types directly
// (it isn't a runtime dep; engine internals are dep-cruiser-fenced off via D-23).
interface BabelNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

interface BabelFile {
  readonly type: "File";
  readonly program: BabelNode;
}

// Stripe SDK call shapes whose 3rd positional argument is the webhook signing secret.
const CONSTRUCT_EVENT_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "constructEvent", // JS/TS: stripe.webhooks.constructEvent / Webhook.constructEvent
]);

function isEmptyStringLiteral(node: BabelNode | undefined): boolean {
  if (!node) return false;
  // Babel parses `''` and `""` as StringLiteral nodes with value === "".
  if (node.type === "StringLiteral" && node["value"] === "") return true;
  // Template strings: `` `` `` parses as TemplateLiteral with no quasis content + no expressions.
  if (node.type === "TemplateLiteral") {
    const quasis = node["quasis"] as ReadonlyArray<BabelNode> | undefined;
    const expressions = node["expressions"] as ReadonlyArray<BabelNode> | undefined;
    if (
      quasis &&
      quasis.length === 1 &&
      (expressions === undefined || expressions.length === 0)
    ) {
      const cooked = (quasis[0]?.["value"] as { cooked?: string } | undefined)?.cooked;
      if (cooked === "") return true;
    }
  }
  return false;
}

type Variant = "or-fallback" | "nullish-fallback" | "ternary" | "explicit-empty-literal";

function classifyEmptySecretArg(arg: BabelNode | undefined): Variant | null {
  if (!arg) return null;

  // Variant 6 — explicit empty string literal at the secret arg position.
  if (isEmptyStringLiteral(arg)) return "explicit-empty-literal";

  // Variants 1 + 2 — LogicalExpression with empty-string right operand.
  if (arg.type === "LogicalExpression") {
    const op = arg["operator"];
    const right = arg["right"] as BabelNode | undefined;
    if (op === "||" && isEmptyStringLiteral(right)) return "or-fallback";
    if (op === "??" && isEmptyStringLiteral(right)) return "nullish-fallback";
  }

  // Variant 3 — ConditionalExpression with empty-string alternate OR consequent.
  if (arg.type === "ConditionalExpression") {
    const consequent = arg["consequent"] as BabelNode | undefined;
    const alternate = arg["alternate"] as BabelNode | undefined;
    if (isEmptyStringLiteral(consequent) || isEmptyStringLiteral(alternate)) return "ternary";
  }

  return null;
}

function getCalleeName(callee: BabelNode | undefined): string | null {
  if (!callee) return null;
  // MemberExpression: `stripe.webhooks.constructEvent` → property = Identifier("constructEvent")
  if (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") {
    const property = callee["property"] as BabelNode | undefined;
    if (property?.type === "Identifier") return String(property["name"] ?? "");
  }
  // Identifier: `constructEvent(...)` — direct call to the imported name.
  if (callee.type === "Identifier") return String(callee["name"] ?? "");
  return null;
}

interface EmptySecretMatch {
  readonly variant: Variant;
  readonly location: { readonly line: number; readonly col: number };
}

function findEmptySecretConstructEventCalls(root: BabelNode): ReadonlyArray<EmptySecretMatch> {
  const matches: EmptySecretMatch[] = [];
  const stack: BabelNode[] = [root];
  const SKIP_KEYS: ReadonlySet<string> = new Set(["loc", "type", "start", "end", "range"]);

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;

    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const callee = node["callee"] as BabelNode | undefined;
      const calleeName = getCalleeName(callee);
      if (calleeName !== null && CONSTRUCT_EVENT_CALLEE_NAMES.has(calleeName)) {
        const args = (node["arguments"] as ReadonlyArray<BabelNode> | undefined) ?? [];
        // Secret is the 3rd positional argument in Stripe's `constructEvent(body, sig, secret)`.
        const secretArg = args[2];
        const variant = classifyEmptySecretArg(secretArg);
        if (variant !== null) {
          const loc = node["loc"] as
            | { start?: { line?: number; column?: number } }
            | undefined;
          matches.push({
            variant,
            location: {
              line: loc?.start?.line ?? 0,
              col: (loc?.start?.column ?? 0) + 1,
            },
          });
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            stack.push(item as BabelNode);
          }
        }
      } else if (value && typeof value === "object" && "type" in (value as object)) {
        stack.push(value as BabelNode);
      }
    }
  }
  return matches;
}

export const stripeEmptySecretPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;

  const parsedFile = model.parsed_files.find((f) => f.file_path === handler.file_path);
  if (!parsedFile) return null;
  if (parsedFile.dialect !== "babel") {
    // Plan 17 ships JS/TS only — Python + PHP coverage deferred to Plan 17b. Return null
    // to defer rather than false-flag on languages whose AST shape we haven't covered yet.
    return null;
  }
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;

  const file = parsedFile.raw_ast as BabelFile;
  const matches = findEmptySecretConstructEventCalls(file.program);

  if (matches.length === 0) return null;

  return "not-verified";
};

// Export the variant classifier + AST walker for tests so the per-variant independence
// assertions can interrogate the classification directly (the public predicate only
// returns the aggregate verdict).
export const __test_only = {
  classifyEmptySecretArg,
  findEmptySecretConstructEventCalls,
  isEmptyStringLiteral,
};
