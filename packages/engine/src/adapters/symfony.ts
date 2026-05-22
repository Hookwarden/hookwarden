// D-31 bespoke adapter: Symfony. PHP attribute routing only:
//   `#[Route('/x', methods: ['POST'])]` on a controller method.
//
// YAML routing scope (Symfony's `config/routes/*.yaml`) is OUT OF SCOPE in v1:
//   - Engine purity (D-01) bans a YAML parser dep; ParsedFile types only model code dialects.
//   - The Phase 8.1 walker (Plan 04) emits PHP source files only — YAML files never reach this
//     adapter as ParsedFile inputs.
//   - Per CONTEXT D-03 Claude's-Discretion: documented as a known limit. Real-world webhook
//     handlers overwhelmingly use attribute routing or src/Controller/ convention; YAML routing
//     for webhooks specifically is uncommon. Plan 10 FP measurement covers the trade-off.
//
// Pure: tree-sitter trees + ParsedFile only. No I/O.

import type { CandidateHandler } from "../model/catalog.js";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

interface PhpSyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: ReadonlyArray<PhpSyntaxNode>;
  childForFieldName(name: string): PhpSyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<PhpSyntaxNode>;
}

// Symfony's default attribute when `methods:` is omitted accepts all HTTP verbs. The rule pack
// keys on body-bearing methods (POST/PUT/PATCH/DELETE), so omitting `methods:` defaults to the
// permissive set — rules still fire on POST while documentation-style verbs (GET/HEAD/OPTIONS)
// stay quiet at the rule layer per their own gating.
const SYMFONY_DEFAULT_METHODS: ReadonlyArray<string> = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

const CONTROLLER_PATH_RE = /(^|\/)src\/Controller\//;

export function symfonyAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "tree-sitter-php") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];

  const usesSymfony = file.imports.some((i) => i.to_module.startsWith("Symfony\\"));
  const isControllerConvention = CONTROLLER_PATH_RE.test(file.file_path);
  if (!usesSymfony && !isControllerConvention) return [];

  const tree = file.raw_ast as { rootNode: PhpSyntaxNode };
  const out: CandidateHandler[] = [];

  for (const klass of tree.rootNode.descendantsOfType(["class_declaration"])) {
    const className = klass.childForFieldName("name")?.text ?? null;
    const body = klass.childForFieldName("body");
    if (!body) continue;
    for (const method of body.descendantsOfType(["method_declaration"])) {
      const handler = matchAttributeRoutedMethod(method, file, className);
      if (handler !== null) out.push(handler);
    }
  }
  return out;
}

function matchAttributeRoutedMethod(
  method: PhpSyntaxNode,
  file: ParsedFile,
  className: string | null,
): CandidateHandler | null {
  const attrList = method.childForFieldName("attributes");
  if (!attrList) return null;
  for (const group of attrList.descendantsOfType(["attribute_group"])) {
    for (const attr of group.namedChildren) {
      if (attr.type !== "attribute") continue;
      if (!isRouteAttribute(attr)) continue;
      const route = readRouteAttribute(attr);
      if (route === null) continue;
      const methodName = method.childForFieldName("name")?.text ?? null;
      const body = method.childForFieldName("body");
      const span = body
        ? { start: body.startIndex, end: body.endIndex }
        : { start: method.startIndex, end: method.endIndex };
      return {
        framework: "symfony" as Framework,
        framework_version: null, // D-01 — engine never reads composer.json
        route_pattern: route.path,
        http_methods: route.methods,
        file_path: file.file_path,
        location: locOf(attr),
        handler_function_name:
          className && methodName ? `${className}::${methodName}` : methodName,
        handler_body_node: body ?? method,
        handler_source_start: span.start,
        handler_source_end: span.end,
      };
    }
  }
  return null;
}

// Match attributes named `Route` (unqualified) or any qualified name ending in `\Route` —
// catches the canonical `Symfony\Component\Routing\Attribute\Route` plus aliased forms after
// `use Symfony\Component\Routing\Attribute\Route as ApiRoute;` (alias case stays out of scope
// for v1 — only the literal attribute name is checked).
function isRouteAttribute(attr: PhpSyntaxNode): boolean {
  const nameNode = attr.namedChildren.find(
    (c) => c.type === "name" || c.type === "qualified_name" || c.type === "relative_name",
  );
  if (!nameNode) return false;
  const name = nameNode.text;
  if (name === "Route") return true;
  return name.endsWith("\\Route");
}

interface RouteAttribute {
  readonly path: string;
  readonly methods: ReadonlyArray<string>;
}

function readRouteAttribute(attr: PhpSyntaxNode): RouteAttribute | null {
  const args = attr.childForFieldName("parameters");
  if (!args) return null;

  let path: string | null = null;
  const methods: string[] = [];
  let pathFromNamedArg = false;

  for (const arg of args.namedChildren) {
    if (arg.type !== "argument") continue;
    const argName = arg.childForFieldName("name")?.text ?? null;
    const valueNode = arg.namedChildren.find(
      (c) => c.type !== "name" && c.type !== "reference_modifier",
    );
    if (!valueNode) continue;

    // First positional argument or `path:` named arg = route path.
    if (argName === null && path === null && !pathFromNamedArg) {
      const literal = readStringLiteral(valueNode);
      if (literal !== null) path = literal;
      continue;
    }
    if (argName === "path") {
      const literal = readStringLiteral(valueNode);
      if (literal !== null) {
        path = literal;
        pathFromNamedArg = true;
      }
      continue;
    }
    if (argName === "methods") {
      methods.push(...readMethodsArg(valueNode));
    }
  }

  if (path === null) return null;
  return {
    path,
    methods: methods.length > 0 ? methods : SYMFONY_DEFAULT_METHODS,
  };
}

function readMethodsArg(value: PhpSyntaxNode): ReadonlyArray<string> {
  if (value.type === "array_creation_expression") {
    const out: string[] = [];
    for (const elem of value.namedChildren) {
      if (elem.type !== "array_element_initializer") continue;
      const literal = elem.namedChildren.find(
        (c) => c.type === "string" || c.type === "encapsed_string",
      );
      if (!literal) continue;
      const m = stripPhpString(literal.text);
      if (m !== "") out.push(m.toUpperCase());
    }
    return out;
  }
  // Shorthand: `methods: 'POST'`
  const literal = readStringLiteral(value);
  return literal !== null ? [literal.toUpperCase()] : [];
}

function readStringLiteral(node: PhpSyntaxNode): string | null {
  if (node.type !== "string" && node.type !== "encapsed_string") return null;
  return stripPhpString(node.text);
}

function stripPhpString(raw: string): string {
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

function locOf(n: PhpSyntaxNode): SourceLocation {
  return {
    line: n.startPosition.row + 1,
    col: n.startPosition.column + 1,
    end_line: n.endPosition.row + 1,
    end_col: n.endPosition.column + 1,
  };
}
