// D-31 bespoke adapter: Django. Two patterns:
//   1. urls.py: urlpatterns = [path('webhooks/x', view_fn)] → view_fn (cross-file by name)
//   2. CBV:     class StripeView(View): def post(self, ...) → the post method is the handler
// Reflective dispatch is out of scope for v1; Phase 6 corpus run will surface what's missed.
// Pure: tree-sitter trees + ParsedFile only. No I/O.

import type { CandidateHandler } from "../model/catalog.js";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

interface PySyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: ReadonlyArray<PySyntaxNode>;
  childForFieldName(name: string): PySyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<PySyntaxNode>;
}

const CBV_HTTP_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const URL_FUNCTIONS: ReadonlySet<string> = new Set(["path", "re_path"]);

export function djangoAdapter(
  file: ParsedFile,
  allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "tree-sitter-python") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];
  const usesDjango = file.imports.some(
    (i) => i.to_module === "django" || i.to_module.startsWith("django."),
  );
  const isUrlsPy = file.file_path.endsWith("urls.py");
  if (!usesDjango && !isUrlsPy) return [];

  const tree = file.raw_ast as { rootNode: PySyntaxNode };
  const out: CandidateHandler[] = [];

  // Pattern 1 — class-based views.
  for (const klass of tree.rootNode.descendantsOfType(["class_definition"])) {
    out.push(...detectClassBasedView(klass, file, allFiles, usesDjango));
  }

  // Pattern 2 — urls.py function references.
  if (isUrlsPy) {
    for (const call of tree.rootNode.descendantsOfType(["call"])) {
      const handler = matchUrlsPyPath(call, file);
      if (handler !== null) out.push(handler);
    }
  }
  return out;
}

function detectClassBasedView(
  klass: PySyntaxNode,
  file: ParsedFile,
  allFiles: ReadonlyArray<ParsedFile>,
  usesDjango: boolean,
): ReadonlyArray<CandidateHandler> {
  // CBV heuristic: superclass list contains View / APIView / GenericAPIView, OR the file imports django.
  const superList = klass.childForFieldName("superclasses");
  const superText = superList?.text ?? "";
  const isCBV = /\b(View|APIView|GenericAPIView)\b/.test(superText) || usesDjango;
  if (!isCBV) return [];

  const className = klass.childForFieldName("name")?.text ?? null;
  const body = klass.childForFieldName("body");
  if (!body) return [];

  const out: CandidateHandler[] = [];
  for (const fnDef of body.descendantsOfType(["function_definition"])) {
    const methodName = fnDef.childForFieldName("name")?.text;
    if (!methodName) continue;
    const upper = methodName.toUpperCase();
    if (!CBV_HTTP_METHODS.has(upper)) continue;
    out.push({
      framework: "django" as Framework,
      framework_version: null, // issue #5
      route_pattern: resolveCBVRoute(className, allFiles),
      http_methods: [upper],
      file_path: file.file_path,
      location: locOf(fnDef),
      handler_function_name: `${className ?? "<view>"}.${methodName}`,
      handler_body_node: fnDef,
      handler_source_start: fnDef.startIndex,
      handler_source_end: fnDef.endIndex,
    });
  }
  return out;
}

function matchUrlsPyPath(call: PySyntaxNode, file: ParsedFile): CandidateHandler | null {
  const fnText = call.childForFieldName("function")?.text ?? "";
  if (!URL_FUNCTIONS.has(fnText)) return null;
  const args = call.childForFieldName("arguments");
  if (!args) return null;
  const positional = args.namedChildren.filter((c) => c.type !== "keyword_argument");
  const pathArg = positional[0];
  const viewArg = positional[1];
  if (!pathArg || pathArg.type !== "string" || !viewArg) return null;

  const path = `/${stripPyString(pathArg.text).replace(/^\/+/, "")}`;
  // Filter to webhooky paths only — keeps signal high.
  if (!/(webhook|hook|hooks)/i.test(path)) return null;

  return {
    framework: "django" as Framework,
    framework_version: null, // issue #5
    route_pattern: path,
    // urls.py alone doesn't carry methods — assume POST for webhook routes.
    http_methods: ["POST"],
    file_path: file.file_path,
    location: locOf(call),
    handler_function_name: viewArg.text,
    handler_body_node: viewArg, // placeholder; reachability will resolve via the import graph
    handler_source_start: call.startIndex,
    handler_source_end: call.endIndex,
  };
}

// Map className → '/<path>' by scanning every urls.py for `path('...', ClassName.as_view())`.
function resolveCBVRoute(
  className: string | null,
  allFiles: ReadonlyArray<ParsedFile>,
): string {
  if (!className) return "/";
  for (const f of allFiles) {
    if (
      !f.file_path.endsWith("urls.py") ||
      f.dialect !== "tree-sitter-python" ||
      f.raw_ast === null
    ) {
      continue;
    }
    const tree = f.raw_ast as { rootNode: PySyntaxNode };
    for (const call of tree.rootNode.descendantsOfType(["call"])) {
      const fnText = call.childForFieldName("function")?.text ?? "";
      if (!URL_FUNCTIONS.has(fnText)) continue;
      const args = call.childForFieldName("arguments");
      if (!args) continue;
      const positional = args.namedChildren.filter((c) => c.type !== "keyword_argument");
      const pathArg = positional[0];
      const viewArg = positional[1];
      if (!pathArg || pathArg.type !== "string" || !viewArg) continue;
      if (viewArg.text === `${className}.as_view()`) {
        return `/${stripPyString(pathArg.text).replace(/^\/+/, "")}`;
      }
    }
  }
  return "/";
}

function locOf(n: PySyntaxNode): SourceLocation {
  return {
    line: n.startPosition.row + 1,
    col: n.startPosition.column + 1,
    end_line: n.endPosition.row + 1,
    end_col: n.endPosition.column + 1,
  };
}

function stripPyString(raw: string): string {
  let i = 0;
  while (i < raw.length && /[bBrRuUfF]/.test(raw[i] ?? "")) i++;
  const quoted = raw.slice(i);
  if (quoted.startsWith('"""') || quoted.startsWith("'''")) {
    return quoted.slice(3, quoted.length - 3);
  }
  if (quoted.startsWith('"') || quoted.startsWith("'")) {
    return quoted.slice(1, quoted.length - 1);
  }
  return quoted;
}
