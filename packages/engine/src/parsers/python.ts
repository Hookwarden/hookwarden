// Python parser adapter (ENGINE-02). web-tree-sitter (WASM) + tree-sitter-python.
// D-27 all-or-nothing: any ERROR or MISSING node in the parse output triggers a ParseErrorRecord.
// PITFALLS #6: tree-sitter-python decorator-grammar gaps surface here as parse errors,
// NOT as silently-skipped files. The all-or-nothing policy is the user-visible signal.

import type { Node, Tree } from "web-tree-sitter";
import type { ImportEdge, ParseErrorRecord, ParsedFile } from "../types/project-model.js";
import type { PythonRuntime } from "./python-loader.js";

export interface ParsePythonInput {
  readonly file_path: string; // repo-relative
  readonly source_text: string;
}

export async function parsePython(
  input: ParsePythonInput,
  runtime: PythonRuntime,
): Promise<ParsedFile> {
  const { file_path, source_text } = input;
  // tree-sitter never throws on parse — it always returns a tree (possibly null on OOM).
  // Errors surface as ERROR / MISSING nodes inside the tree.
  const tree = runtime.parser.parse(source_text);
  let parse_error: ParseErrorRecord | null = null;
  if (tree === null) {
    parse_error = {
      message: "tree-sitter-python: parser returned null tree",
      location: { line: 1, col: 1 },
      source: "tree-sitter",
    };
  } else {
    parse_error = findFirstError(tree.rootNode);
  }
  const cleanTree: Tree | null = parse_error === null ? tree : null;
  const imports: ReadonlyArray<ImportEdge> =
    cleanTree === null ? [] : extractImports(cleanTree.rootNode, file_path);
  return {
    file_path,
    language: "python",
    dialect: "tree-sitter-python",
    source_text,
    raw_ast: cleanTree, // D-27: null on error
    imports,
    parse_error,
  };
}

function findFirstError(root: Node): ParseErrorRecord | null {
  // DFS from rootNode; stop at first ERROR or MISSING node.
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.type === "ERROR" || node.isMissing) {
      return {
        message: node.isMissing
          ? `tree-sitter-python: missing token (${node.type})`
          : `tree-sitter-python: ERROR node at ${node.startPosition.row + 1}:${node.startPosition.column + 1}`,
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

function extractImports(root: Node, from_file: string): ReadonlyArray<ImportEdge> {
  const out: ImportEdge[] = [];
  // tree-sitter-python distinguishes:
  //   import_statement       → `import a`, `import a as b`, `import a, c`
  //   import_from_statement  → `from a import b`, `from a import b as c`, `from a import (b, c)`
  for (const node of root.descendantsOfType(["import_statement", "import_from_statement"])) {
    if (node.type === "import_statement") {
      // Children include dotted_name | aliased_import nodes.
      for (const child of node.namedChildren) {
        if (child === null) continue;
        if (child.type === "dotted_name") {
          out.push({
            from_file,
            to_module: child.text,
            imported_names: [{ local: child.text, source: "default" }],
            is_default: true,
          });
        } else if (child.type === "aliased_import") {
          const name = child.childForFieldName("name")?.text ?? "";
          const alias = child.childForFieldName("alias")?.text ?? name;
          out.push({
            from_file,
            to_module: name,
            imported_names: [{ local: alias, source: "default" }],
            is_default: true,
          });
        }
      }
    } else {
      // import_from_statement. The module_name field child is itself a dotted_name, so identifying
      // imported-name children requires comparing byte offsets — tree-sitter returns fresh node
      // objects on each accessor, so reference equality is not reliable.
      const moduleNode = node.childForFieldName("module_name");
      const moduleName = moduleNode?.text ?? "";
      const moduleStart = moduleNode?.startIndex ?? -1;
      const moduleEnd = moduleNode?.endIndex ?? -1;
      const names: Array<{ local: string; source: string }> = [];
      for (const child of node.namedChildren) {
        if (child === null) continue;
        // Skip the module_name child by byte-offset match.
        if (child.startIndex === moduleStart && child.endIndex === moduleEnd) continue;
        if (child.type === "dotted_name") {
          names.push({ local: child.text, source: child.text });
        } else if (child.type === "aliased_import") {
          const src = child.childForFieldName("name")?.text ?? "";
          const alias = child.childForFieldName("alias")?.text ?? src;
          names.push({ local: alias, source: src });
        }
      }
      if (moduleName !== "") {
        out.push({ from_file, to_module: moduleName, imported_names: names, is_default: false });
      }
    }
  }
  return out;
}
