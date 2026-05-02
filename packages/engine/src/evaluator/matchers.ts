// D-28: declarative matcher implementations. Each returns Verdict | null.
// null = matcher does not apply to this handler (engine emits no Finding for that rule).
// Pure: WebhookHandler + ProjectModel + ProviderCatalog inputs only. No I/O.
//
// Issue #6 fix: argumentEquals is fully implemented. It walks the handler's source-file AST
// for a CallExpression whose callee matches the rule's `call`, then compares args[arg_index]'s
// literal value to `equals`.

import type { Expression, File, Node } from "@babel/types";
import { walkBabelAst } from "../parsers/walk.js";
import type { Verdict } from "../types/finding.js";
import type { WebhookHandler } from "../types/handler.js";
import type { ProjectModel } from "../types/project-model.js";
import type { DeclarativeMatcher, ProviderCatalog } from "../types/rule-set.js";

export interface ApplyMatcherInput {
  readonly matcher: DeclarativeMatcher;
  readonly handler: WebhookHandler;
  readonly model: ProjectModel;
  readonly providers: ProviderCatalog;
  readonly emits_state: Verdict;
}

export function applyMatcher(input: ApplyMatcherInput): Verdict | null {
  const { matcher, handler, emits_state } = input;
  const args = matcher.args as Record<string, unknown>;
  switch (matcher.name) {
    case "importMissing": {
      const module = String(args["module"] ?? "");
      const file = input.model.parsed_files.find((f) => f.file_path === handler.file_path);
      const present = file?.imports.some((i) => i.to_module === module) ?? false;
      return present ? null : emits_state;
    }
    case "callMatches": {
      const qn = String(args["qualified_name"] ?? "");
      const present = handler.reachable_symbols.some(
        (s) => s.qualified_name === qn || s.qualified_name.endsWith(`.${qn}`),
      );
      return present ? emits_state : null;
    }
    case "secretLiteralPrefix": {
      const prefix = String(args["prefix"] ?? "");
      const present = handler.evidence.some(
        (e) => e.kind === "secret_literal_match" && e.detail === prefix,
      );
      return present ? emits_state : null;
    }
    case "signatureHeaderRead": {
      const header = String(args["header"] ?? "").toLowerCase();
      const present = handler.evidence.some(
        (e) => e.kind === "signature_header_read" && e.detail.toLowerCase() === header,
      );
      return present ? emits_state : null;
    }
    case "middlewareOrder": {
      const before = String(args["before"] ?? "");
      const after = String(args["after"] ?? "");
      const chain = handler.middleware_chain;
      const idxBefore = chain.findIndex((m) => m.name === before);
      const idxAfter = chain.findIndex((m) => m.name === after);
      if (idxBefore < 0 || idxAfter < 0) return null;
      return idxBefore < idxAfter ? emits_state : null;
    }
    case "argumentEquals": {
      // Issue #6 fix — IMPLEMENTED. Walk the handler's source file AST for a CallExpression whose
      // callee matches `call`; compare args[arg_index]'s literal value to `equals`.
      const callName = String(args["call"] ?? "");
      const argIndex = typeof args["arg_index"] === "number" ? args["arg_index"] : 0;
      const equals = args["equals"];
      // Quick reachability gate — if the call isn't even reachable, the matcher cannot apply.
      const reachable = handler.reachable_symbols.some(
        (s) => s.qualified_name === callName || s.qualified_name.endsWith(`.${callName}`),
      );
      if (!reachable) return null;
      const file = input.model.parsed_files.find((f) => f.file_path === handler.file_path);
      if (!file || file.parse_error !== null || file.raw_ast === null) return null;
      if (file.dialect !== "babel") {
        // Python AST argument inspection has a different tree-sitter shape. v1 supports Babel;
        // Python rules that need argumentEquals can use a TS predicate (D-28 escape hatch).
        return null;
      }
      const matched = findCallArgEquals(file.raw_ast as File, callName, argIndex, equals);
      if (matched === null) return null;
      return matched ? emits_state : null;
    }
    default: {
      // Exhaustiveness check — TS will error here if a new MatcherName is added without a case.
      const exhaustiveCheck: never = matcher.name;
      throw new Error(`unsupported matcher name: ${String(exhaustiveCheck)}`);
    }
  }
}

// Babel AST walker: returns true if any CallExpression with matching callee qname has its
// argN literal === equals; false if a matching call exists but the arg differs; null if no
// matching call exists at all (matcher does not apply).
function findCallArgEquals(
  ast: File,
  callName: string,
  argIndex: number,
  equals: unknown,
): boolean | null {
  let foundAnyCall = false;
  let foundMatch = false;
  walkBabelAst(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const qn = qnameBabel(node.callee);
    if (qn === null) return;
    if (qn !== callName && !qn.endsWith(`.${callName}`)) return;
    foundAnyCall = true;
    const arg = node.arguments[argIndex];
    if (!arg) return;
    if (arg.type === "StringLiteral" && typeof equals === "string" && arg.value === equals) {
      foundMatch = true;
    } else if (
      arg.type === "NumericLiteral" &&
      typeof equals === "number" &&
      arg.value === equals
    ) {
      foundMatch = true;
    } else if (typeof equals === "string" && equals === "") {
      // Rule emits "" to mean "no value" — match against null/undefined args.
      if (arg.type === "NullLiteral") foundMatch = true;
      else if (arg.type === "Identifier" && arg.name === "undefined") foundMatch = true;
    }
  });
  if (!foundAnyCall) return null;
  return foundMatch;
}

function qnameBabel(node: Expression | Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = qnameBabel(node.object);
    if (!obj) return null;
    if (node.property.type === "Identifier") return `${obj}.${node.property.name}`;
  }
  return null;
}
