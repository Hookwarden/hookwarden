// Go parser adapter (ENGINE-02). web-tree-sitter (WASM) + tree-sitter-go@0.25.0.
// Node-type strings below verified against tree-sitter-go@0.25.0 src/node-types.json
// (import_declaration, import_spec_list, import_spec{path,name}, interpreted_string_literal,
// raw_string_literal) — same legitimacy lineage (maxbrunsfeld) as the shipped python/php grammars.
// D-27 all-or-nothing: any ERROR or MISSING node in the parse output triggers a ParseErrorRecord.
// PITFALLS-equivalent for Go: tree-sitter-go grammar gaps surface here as parse errors,
// NOT as silently-skipped files. The all-or-nothing policy is the user-visible signal.
// D-25 ImportEdge contract: `import "crypto/hmac"`, grouped `import ( ... )`, and aliased
// `import gh "github.com/..."` all flow through extractImports below.

import type { Node, Tree } from "web-tree-sitter";
import type { ImportEdge, ParsedFile, ParseErrorRecord } from "../types/project-model.js";
import type { GoRuntime } from "./go-loader.js";

export interface ParseGoInput {
  readonly file_path: string; // repo-relative
  readonly source_text: string;
}

export async function parseGo(input: ParseGoInput, runtime: GoRuntime): Promise<ParsedFile> {
  const { file_path, source_text } = input;
  // tree-sitter never throws on parse — it always returns a tree (possibly null on OOM).
  // Errors surface as ERROR / MISSING nodes inside the tree.
  const tree = runtime.parser.parse(source_text);
  let parseError: ParseErrorRecord | null = null;
  if (tree === null) {
    parseError = {
      message: "tree-sitter-go: parser returned null tree",
      location: { line: 1, col: 1 },
      source: "tree-sitter",
    };
  } else {
    parseError = findFirstError(tree.rootNode);
  }
  const cleanTree: Tree | null = parseError === null ? tree : null;
  const imports: ReadonlyArray<ImportEdge> =
    cleanTree === null ? [] : extractImports(cleanTree.rootNode, file_path);
  return {
    file_path,
    language: "go",
    dialect: "tree-sitter-go",
    source_text,
    raw_ast: cleanTree, // D-27: null on error
    imports,
    parse_error: parseError,
  };
}

function findFirstError(root: Node): ParseErrorRecord | null {
  // DFS from rootNode; stop at first ERROR or MISSING node. Algorithm is grammar-agnostic.
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.type === "ERROR" || node.isMissing) {
      return {
        message: node.isMissing
          ? `tree-sitter-go: missing token (${node.type})`
          : `tree-sitter-go: ERROR node at ${node.startPosition.row + 1}:${node.startPosition.column + 1}`,
        location: { line: node.startPosition.row + 1, col: node.startPosition.column + 1 },
        source: "tree-sitter",
      };
    }
    if (!node.hasError) continue; // entire subtree is clean; skip
    for (const child of node.namedChildren) {
      if (child !== null) stack.push(child);
    }
  }
  return null;
}

function stripQuotes(raw: string): string {
  // Go import paths are interpreted_string_literal ("...") or, rarely, raw_string_literal (`...`).
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "`" && last === "`")) {
      return raw.slice(1, raw.length - 1);
    }
  }
  return raw;
}

function lastSegment(module: string): string {
  // Local package name defaults to the last slash-delimited path segment.
  // Versioned module paths (".../v62") fall back to the segment before the version.
  const segments = module.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return module;
  const last = segments[segments.length - 1] ?? module;
  if (/^v[0-9]+$/.test(last) && segments.length >= 2) {
    return segments[segments.length - 2] ?? last;
  }
  return last;
}

function extractImports(root: Node, fromFile: string): ReadonlyArray<ImportEdge> {
  const out: ImportEdge[] = [];
  // tree-sitter-go@0.25.0 node-types.json:
  //   import_declaration → `import "x"`, `import ( ... )`
  //   import_spec_list   → body of the grouped form
  //   import_spec        → per-import: field `path` (string literal), optional field `name`
  //                        (alias: blank_identifier `_`, dot `.`, or package_identifier)
  for (const spec of root.descendantsOfType("import_spec")) {
    const pathNode = spec.childForFieldName("path");
    if (pathNode === null) continue;
    const toModule = stripQuotes(pathNode.text);
    if (toModule === "") continue;
    const nameNode = spec.childForFieldName("name");
    // `_` (blank) and `.` (dot) aliases have no usable local binding for attribution;
    // fall back to the path's last segment so the edge still names a module.
    const aliasText = nameNode?.text;
    const local =
      aliasText !== undefined && aliasText !== "_" && aliasText !== "."
        ? aliasText
        : lastSegment(toModule);
    out.push({
      from_file: fromFile,
      to_module: toModule,
      imported_names: [{ local, source: "default" }],
      is_default: true,
    });
  }
  return out;
}
