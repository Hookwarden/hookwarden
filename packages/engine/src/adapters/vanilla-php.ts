// D-31 bespoke adapter: vanilla-PHP single-file webhook handlers. No framework imports;
// route emerges from the file's basename (per CONTEXT D-03). Detection is heuristic — we
// look for telltale signals (php://input read, hash_hmac call, $_SERVER signature header,
// getallheaders) to distinguish a webhook handler from arbitrary PHP source. v1 threshold:
// >= 1 signal qualifies (per CONTEXT Claude's-Discretion). Plan 10 FP measurement will
// re-tune if over-emission shows up.
//
// Pure: tree-sitter trees + ParsedFile only. No node:path import — basename math is done
// inline via string slicing to preserve engine purity (D-01).

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

// Namespaces that disqualify a file from the vanilla classification — if any framework is
// imported, that framework's adapter (catalog or bespoke) owns detection.
const FRAMEWORK_PREFIXES: ReadonlyArray<string> = ["Illuminate\\", "Symfony\\", "Slim\\"];

export function vanillaPhpAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "tree-sitter-php") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];
  if (file.imports.some((i) => FRAMEWORK_PREFIXES.some((p) => i.to_module.startsWith(p)))) {
    return [];
  }

  const tree = file.raw_ast as { rootNode: PhpSyntaxNode };
  const signal = detectVanillaSignals(tree.rootNode);
  if (signal.count < 1) return [];

  const routePattern = deriveRoute(file.file_path);
  const httpMethods = detectRequestMethods(tree.rootNode);

  return [
    {
      framework: "vanilla-php" as Framework,
      framework_version: null,
      route_pattern: routePattern,
      http_methods: httpMethods,
      file_path: file.file_path,
      location: signal.firstLocation,
      handler_function_name: null,
      handler_body_node: tree.rootNode,
      handler_source_start: tree.rootNode.startIndex,
      handler_source_end: tree.rootNode.endIndex,
    },
  ];
}

interface VanillaSignal {
  readonly count: number;
  readonly firstLocation: SourceLocation;
}

// Walk once and count signals + capture the first signal-bearing node's location.
function detectVanillaSignals(root: PhpSyntaxNode): VanillaSignal {
  let count = 0;
  let firstLoc: SourceLocation | null = null;
  const mark = (n: PhpSyntaxNode): void => {
    count++;
    if (firstLoc === null) firstLoc = locOf(n);
  };

  // Signal A — file_get_contents('php://input')
  for (const call of root.descendantsOfType(["function_call_expression"])) {
    const fn = call.childForFieldName("function");
    if (fn?.text === "file_get_contents") {
      const args = call.childForFieldName("arguments");
      const firstArg = args?.namedChildren.find((c) => c.type === "argument");
      const literal = firstArg?.namedChildren.find(
        (c) => c.type === "string" || c.type === "encapsed_string",
      );
      if (literal && stripPhpString(literal.text) === "php://input") mark(call);
    }
    // Signal B — hash_hmac(...)
    if (fn?.text === "hash_hmac") mark(call);
    // Signal D — getallheaders()
    if (fn?.text === "getallheaders") mark(call);
  }

  // Signal C — $_SERVER['HTTP_*_SIGNATURE'] subscript access. Loose match: any HTTP_* server var
  // could be a signature header. Tight match (HTTP_*SIGNATURE) is more selective; we use tight.
  for (const sub of root.descendantsOfType(["subscript_expression"])) {
    const subject = sub.namedChildren[0];
    if (!subject || subject.type !== "variable_name" || subject.text !== "$_SERVER") continue;
    const idx = sub.namedChildren[1];
    if (!idx) continue;
    if (idx.type !== "string" && idx.type !== "encapsed_string") continue;
    const key = stripPhpString(idx.text);
    if (/^HTTP_.*SIGNATURE/i.test(key)) mark(sub);
  }

  if (firstLoc === null) {
    firstLoc = { line: 1, col: 1, end_line: 1, end_col: 1 };
  }
  return { count, firstLocation: firstLoc };
}

// Derive `/<basename-without-ext>` from a file path. Nested paths collapse to basename per D-03.
//   webhook.php             → /webhook
//   webhooks/stripe.php     → /stripe
//   src/handlers/x.php      → /x
// Pure string math: no node:path import (engine purity D-01).
function deriveRoute(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  const basename = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
  const noExt = basename.endsWith(".php") ? basename.slice(0, -4) : basename;
  return `/${noExt}`;
}

const BODY_METHOD_NAMES: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
]);

// Detect REQUEST_METHOD gating near the top of the file. Three shapes supported:
//   if ($_SERVER['REQUEST_METHOD'] !== 'POST') ...   → ["POST"] (negated guard pattern)
//   if ($_SERVER['REQUEST_METHOD'] === 'POST') ...   → ["POST"] (positive form)
//   if (!in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT'])) ... → ["POST", "PUT"]
// Default when no guard found: ["POST"] (vanilla webhooks default to POST per CONTEXT D-03).
function detectRequestMethods(root: PhpSyntaxNode): ReadonlyArray<string> {
  for (const ifs of root.descendantsOfType(["if_statement"])) {
    const cond = ifs.childForFieldName("condition");
    if (!cond) continue;
    const methods = extractMethodsFromCondition(cond);
    if (methods.length > 0) return methods;
  }
  return ["POST"];
}

function extractMethodsFromCondition(cond: PhpSyntaxNode): ReadonlyArray<string> {
  const text = cond.text;
  // Quick reject — only conditions that reference REQUEST_METHOD are interesting.
  if (!text.includes("REQUEST_METHOD")) return [];

  // in_array form — extract the array literal's string members.
  const inArrayMatch = text.match(/in_array\s*\([^)]*REQUEST_METHOD[^,]*,\s*\[([^\]]+)\]/i);
  if (inArrayMatch?.[1]) {
    return Array.from(inArrayMatch[1].matchAll(/['"]([A-Za-z]+)['"]/g))
      .map((m) => (m[1] ?? "").toUpperCase())
      .filter((m) => BODY_METHOD_NAMES.has(m));
  }

  // Equality form — extract the verb on either side of the comparison.
  const eqMatch = text.match(/REQUEST_METHOD['"]\s*\][^=!]*[=!]==?\s*['"]([A-Za-z]+)['"]/);
  if (eqMatch?.[1]) {
    const verb = eqMatch[1].toUpperCase();
    if (BODY_METHOD_NAMES.has(verb)) return [verb];
  }
  return [];
}

function locOf(n: PhpSyntaxNode): SourceLocation {
  return {
    line: n.startPosition.row + 1,
    col: n.startPosition.column + 1,
    end_line: n.endPosition.row + 1,
    end_col: n.endPosition.column + 1,
  };
}

function stripPhpString(raw: string): string {
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}
