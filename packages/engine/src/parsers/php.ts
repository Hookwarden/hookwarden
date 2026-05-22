// PHP parser adapter (ENGINE-02). web-tree-sitter (WASM) + tree-sitter-php@0.24.2.
// D-27 all-or-nothing: any ERROR or MISSING node in the parse output triggers a ParseErrorRecord.
// PITFALLS-equivalent for PHP: tree-sitter-php grammar gaps surface here as parse errors,
// NOT as silently-skipped files. The all-or-nothing policy is the user-visible signal.
// D-25 ImportEdge contract: `use Foo\Bar;`, `use Foo\Bar as Baz;`, and `use Foo\{Bar, Baz};`
// (group) all flow through extractImports below.

import type { Node, Tree } from "web-tree-sitter";
import type { ImportEdge, ParsedFile, ParseErrorRecord } from "../types/project-model.js";
import type { PhpRuntime } from "./php-loader.js";

export interface ParsePhpInput {
  readonly file_path: string; // repo-relative
  readonly source_text: string;
}

export async function parsePhp(input: ParsePhpInput, runtime: PhpRuntime): Promise<ParsedFile> {
  const { file_path, source_text } = input;
  // tree-sitter never throws on parse — it always returns a tree (possibly null on OOM).
  // Errors surface as ERROR / MISSING nodes inside the tree.
  const tree = runtime.parser.parse(source_text);
  let parseError: ParseErrorRecord | null = null;
  if (tree === null) {
    parseError = {
      message: "tree-sitter-php: parser returned null tree",
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
    language: "php",
    dialect: "tree-sitter-php",
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
          ? `tree-sitter-php: missing token (${node.type})`
          : `tree-sitter-php: ERROR node at ${node.startPosition.row + 1}:${node.startPosition.column + 1}`,
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

function lastSegment(fqn: string): string {
  const idx = fqn.lastIndexOf("\\");
  return idx === -1 ? fqn : fqn.slice(idx + 1);
}

function extractImports(root: Node, fromFile: string): ReadonlyArray<ImportEdge> {
  const out: ImportEdge[] = [];
  // tree-sitter-php@0.24.2 node-types.json:
  //   namespace_use_declaration  → `use Foo\Bar;`, `use Foo\Bar as Baz;`, `use Foo\{Bar, Baz};`
  //   namespace_use_clause       → per-name child (FQN + optional alias)
  //   namespace_use_group        → body of group form (children = clauses)
  //   namespace_name             → prefix for group form (only direct child of declaration)
  for (const decl of root.descendantsOfType("namespace_use_declaration")) {
    const body = decl.childForFieldName("body"); // null for non-group form
    if (body !== null && body.type === "namespace_use_group") {
      // Group form: `use Foo\{Bar, Baz};` — declaration has a namespace_name (prefix) sibling
      // and a body of type namespace_use_group containing clauses.
      const prefixNode = decl.namedChildren.find((c) => c !== null && c.type === "namespace_name");
      const prefix = prefixNode?.text ?? "";
      for (const clause of body.namedChildren) {
        if (clause === null || clause.type !== "namespace_use_clause") continue;
        const suffixNode = clause.namedChildren.find(
          (c) => c !== null && (c.type === "name" || c.type === "qualified_name"),
        );
        const suffix = suffixNode?.text ?? "";
        const aliasNode = clause.childForFieldName("alias");
        const toModule = prefix === "" ? suffix : `${prefix}\\${suffix}`;
        const local = aliasNode?.text ?? lastSegment(suffix);
        out.push({
          from_file: fromFile,
          to_module: toModule,
          imported_names: [{ local, source: "default" }],
          is_default: true,
        });
      }
    } else {
      // Non-group form: `use Foo\Bar;` or `use Foo\Bar as Baz;`. Declaration's direct named
      // children are namespace_use_clauses (one per name in a comma-separated list).
      for (const clause of decl.namedChildren) {
        if (clause === null || clause.type !== "namespace_use_clause") continue;
        const fqnNode = clause.namedChildren.find(
          (c) => c !== null && (c.type === "name" || c.type === "qualified_name"),
        );
        const fqn = fqnNode?.text ?? "";
        if (fqn === "") continue;
        const aliasNode = clause.childForFieldName("alias");
        const local = aliasNode?.text ?? lastSegment(fqn);
        out.push({
          from_file: fromFile,
          to_module: fqn,
          imported_names: [{ local, source: "default" }],
          is_default: true,
        });
      }
    }
  }
  return out;
}
