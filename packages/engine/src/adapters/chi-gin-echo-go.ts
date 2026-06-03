// Phase 27 (RULES-GO-01) bespoke adapter: chi / gin / echo Go router webhook handlers.
// Import-gated — only fires on files importing github.com/go-chi/chi, github.com/gin-gonic/gin,
// or github.com/labstack/echo (tolerating a trailing /vN module-version segment). Detects route
// registrations of the shape `<router>.Post("/path", handler)` (chi: capitalized Post/Get/...;
// gin/echo: uppercase POST/GET/...) for body-bearing HTTP methods, and emits one CandidateHandler
// per route with the handler argument as the body node.
//
// Runs BEFORE netHttpGoAdapter in ALL_ADAPTERS (framework-gated before heuristic catch-all), and
// netHttpGoAdapter import-negative-gates these same prefixes, so a file is owned by exactly one.
//
// Pure: tree-sitter trees + ParsedFile only. Re-declares its own structural node type — never
// imports web-tree-sitter (engine purity D-01).

import type { CandidateHandler } from "../model/catalog.js";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

interface GoSyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: ReadonlyArray<GoSyntaxNode>;
  childForFieldName(name: string): GoSyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<GoSyntaxNode>;
}

const FRAMEWORK_BY_PREFIX: ReadonlyArray<{ prefix: string; framework: Framework }> = [
  { prefix: "github.com/go-chi/chi", framework: "chi" },
  { prefix: "github.com/gin-gonic/gin", framework: "gin" },
  { prefix: "github.com/labstack/echo", framework: "echo" },
];

// Body-bearing HTTP methods, in both chi's TitleCase and gin/echo's UPPERCASE forms.
const ROUTE_METHODS: ReadonlySet<string> = new Set([
  "Post",
  "POST",
  "Put",
  "PUT",
  "Patch",
  "PATCH",
  "Delete",
  "DELETE",
]);

export function chiGinEchoGoAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "tree-sitter-go") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];

  const framework = detectFramework(file);
  if (framework === null) return [];

  const tree = file.raw_ast as { rootNode: GoSyntaxNode };
  const out: CandidateHandler[] = [];

  for (const call of tree.rootNode.descendantsOfType(["call_expression"])) {
    const fn = call.childForFieldName("function");
    if (fn === null || fn.type !== "selector_expression") continue;
    const methodField = fn.childForFieldName("field");
    if (methodField === null || !ROUTE_METHODS.has(methodField.text)) continue;

    const args = call.childForFieldName("arguments");
    if (args === null) continue;
    const argExprs = args.namedChildren;
    if (argExprs.length < 2) continue;

    const pathNode = argExprs[0];
    if (
      pathNode === undefined ||
      (pathNode.type !== "interpreted_string_literal" && pathNode.type !== "raw_string_literal")
    ) {
      continue;
    }
    const path = stripGoString(pathNode.text);

    const handlerArg = argExprs[argExprs.length - 1];
    if (handlerArg === undefined) continue;
    const resolved = resolveHandlerBody(handlerArg, tree.rootNode);

    out.push({
      framework,
      framework_version: null,
      route_pattern: path,
      http_methods: [methodField.text.toUpperCase()],
      file_path: file.file_path,
      location: locOf(call),
      handler_function_name: resolved.name,
      handler_body_node: resolved.node,
      handler_source_start: resolved.node.startIndex,
      handler_source_end: resolved.node.endIndex,
    });
  }
  return out;
}

function detectFramework(file: ParsedFile): Framework | null {
  for (const { prefix, framework } of FRAMEWORK_BY_PREFIX) {
    if (file.imports.some((i) => i.to_module.startsWith(prefix))) return framework;
  }
  return null;
}

// The handler arg is either an inline func_literal (analyze it directly) or an identifier naming a
// same-file function_declaration (resolve to its node so the constant-time predicate can scope to
// the real body). An identifier with no resolvable same-file declaration falls back to the arg
// node itself — evidence will find no receiving signal and build.ts demotes attribution.
function resolveHandlerBody(
  handlerArg: GoSyntaxNode,
  root: GoSyntaxNode,
): { node: GoSyntaxNode; name: string | null } {
  if (handlerArg.type === "func_literal") {
    return { node: handlerArg, name: null };
  }
  if (handlerArg.type === "identifier") {
    const name = handlerArg.text;
    for (const fn of root.descendantsOfType(["function_declaration"])) {
      if (fn.childForFieldName("name")?.text === name) return { node: fn, name };
    }
    return { node: handlerArg, name };
  }
  return { node: handlerArg, name: null };
}

function stripGoString(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "`" && last === "`")) {
      return raw.slice(1, raw.length - 1);
    }
  }
  return raw;
}

function locOf(n: GoSyntaxNode): SourceLocation {
  return {
    line: n.startPosition.row + 1,
    col: n.startPosition.column + 1,
    end_line: n.endPosition.row + 1,
    end_col: n.endPosition.column + 1,
  };
}
