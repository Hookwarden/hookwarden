// D-31 bespoke adapter: FastAPI. @router.post('/x') / @app.post('/x') on async def.
// Cross-file include_router prefix resolution via single-pass scan over allFiles.
// Pure: tree-sitter trees + ParsedFile only. No I/O.

import type { CandidateHandler } from "../model/catalog.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

interface PySyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly children: ReadonlyArray<PySyntaxNode>;
  readonly namedChildren: ReadonlyArray<PySyntaxNode>;
  childForFieldName(name: string): PySyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<PySyntaxNode>;
}

const BODY_METHODS: ReadonlySet<string> = new Set(["post", "put", "patch", "delete"]);

export function fastapiAdapter(
  file: ParsedFile,
  allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "tree-sitter-python") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];
  const usesFastAPI = file.imports.some(
    (i) => i.to_module === "fastapi" || i.to_module.startsWith("fastapi."),
  );
  if (!usesFastAPI) return [];

  const tree = file.raw_ast as { rootNode: PySyntaxNode };
  const prefixByRouterVar = collectIncludeRouterPrefixes(allFiles);

  const out: CandidateHandler[] = [];
  for (const node of tree.rootNode.descendantsOfType(["decorated_definition"])) {
    const handler = matchFastApiDecorator(node, file, prefixByRouterVar);
    if (handler !== null) out.push(handler);
  }
  return out;
}

function matchFastApiDecorator(
  node: PySyntaxNode,
  file: ParsedFile,
  prefixByRouterVar: Map<string, string>,
): CandidateHandler | null {
  const fnDef = node.namedChildren.find((c) => c.type === "function_definition");
  if (!fnDef) return null;

  for (const dec of node.descendantsOfType(["decorator"])) {
    const call = dec.descendantsOfType(["call"])[0];
    if (!call) continue;
    const fnText = call.childForFieldName("function")?.text ?? "";
    const dot = fnText.lastIndexOf(".");
    if (dot < 0) continue;
    const routerVar = fnText.slice(0, dot);
    const methodName = fnText.slice(dot + 1);
    if (!BODY_METHODS.has(methodName)) continue;

    const args = call.childForFieldName("arguments");
    if (!args) continue;
    const pathArg = args.namedChildren.find((c) => c.type === "string");
    if (!pathArg) continue;
    const path = stripPyString(pathArg.text);
    const prefix = prefixByRouterVar.get(routerVar) ?? "";
    const routePattern = prefix + path;

    return {
      framework: "fastapi" as Framework,
      framework_version: null, // issue #5
      route_pattern: routePattern,
      http_methods: [methodName.toUpperCase()],
      file_path: file.file_path,
      location: {
        line: node.startPosition.row + 1,
        col: node.startPosition.column + 1,
        end_line: node.endPosition.row + 1,
        end_col: node.endPosition.column + 1,
      },
      handler_function_name: fnDef.childForFieldName("name")?.text ?? null,
      handler_body_node: fnDef,
      handler_source_start: fnDef.startIndex,
      handler_source_end: fnDef.endIndex,
    };
  }
  return null;
}

// Map router-variable-name → prefix from `app.include_router(router_var, prefix='/api')`
// across every Python file. Cross-file: a router defined in module A and included in module B
// resolves as long as both files are in `allFiles`.
function collectIncludeRouterPrefixes(allFiles: ReadonlyArray<ParsedFile>): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of allFiles) {
    if (f.dialect !== "tree-sitter-python" || f.raw_ast === null) continue;
    const tree = f.raw_ast as { rootNode: PySyntaxNode };
    for (const call of tree.rootNode.descendantsOfType(["call"])) {
      const fnText = call.childForFieldName("function")?.text ?? "";
      if (!fnText.endsWith(".include_router")) continue;
      const args = call.childForFieldName("arguments");
      if (!args) continue;
      const positional = args.namedChildren.filter((c) => c.type !== "keyword_argument");
      const routerArg = positional[0];
      if (!routerArg) continue;
      const routerName = routerArg.text;
      let prefix = "";
      for (const kw of args.namedChildren) {
        if (kw.type !== "keyword_argument") continue;
        if (kw.childForFieldName("name")?.text !== "prefix") continue;
        const valNode = kw.childForFieldName("value");
        if (valNode?.type === "string") prefix = stripPyString(valNode.text);
      }
      if (prefix !== "") out.set(routerName, prefix);
    }
  }
  return out;
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
