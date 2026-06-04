// D-34: bounded-depth reachable symbols, with cross-file traversal via ImportEdge.
// Walks the import graph + intra-file call graph + middleware chain to a configurable depth
// (default 3 hops). Catches: middleware verification, util-extracted verification,
// decorator-applied verification. Misses: dynamic dispatch, reflection — surfaced as
// `manual-review` candidates by rules (PITFALLS #3 graded-confidence policy).
//
// Caps:
//   - maxDepth (caller-supplied via config.reachability_max_depth; default 3)
//   - MAX_VISITED_SYMBOLS = 1000 per handler (DoS defense — threat-model T-02-06b-04)

import type { Expression, File, Node } from "@babel/types";
import { walkBabelAst } from "../parsers/walk.js";
import type { ReachableSymbol } from "../types/handler.js";
import type { ImportEdge, ParsedFile } from "../types/project-model.js";

const MAX_VISITED_SYMBOLS = 1000;

// Tree-sitter SyntaxNode — local declaration to keep the model layer independent of
// web-tree-sitter's exported types.
interface PySyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly children: ReadonlyArray<PySyntaxNode>;
  readonly namedChildren: ReadonlyArray<PySyntaxNode>;
  childForFieldName(name: string): PySyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<PySyntaxNode>;
}

export interface ComputeReachabilityInput {
  readonly handler_body_node: unknown;
  readonly handler_file: ParsedFile;
  readonly all_files: ReadonlyArray<ParsedFile>;
  readonly imports: ReadonlyArray<ImportEdge>;
  readonly maxDepth: number;
}

interface SymbolEntry {
  readonly qualified_name: string;
  readonly import_source: string | null;
  readonly hops: number;
  readonly via: string;
}

interface FileSymbolTable {
  readonly file: ParsedFile;
  readonly symbols: Map<string, unknown>;
}

export function computeReachableSymbols(
  input: ComputeReachabilityInput,
): ReadonlyArray<ReachableSymbol> {
  const visited = new Set<string>();
  const out: SymbolEntry[] = [];

  // Index every file's top-level symbols so cross-file traversal can resolve `mod.name` → AST.
  const symbolTables = new Map<string, FileSymbolTable>();
  for (const f of input.all_files) {
    if (f.parse_error !== null || f.raw_ast === null) continue;
    symbolTables.set(f.file_path, { file: f, symbols: buildSymbolTable(f) });
  }

  const record = (entry: SymbolEntry): boolean => {
    if (visited.has(entry.qualified_name)) return false;
    if (visited.size >= MAX_VISITED_SYMBOLS) return false; // T-02-06b-04 DoS cap
    visited.add(entry.qualified_name);
    out.push(entry);
    return true;
  };

  // Hop 1: direct calls in the handler body.
  for (const call of collectCalls(input.handler_body_node, input.handler_file.dialect)) {
    record({
      qualified_name: call,
      import_source: resolveImportSource(call, input.imports),
      hops: 1,
      via: "direct call",
    });
  }

  // BFS frontier — each entry tracks the file that defined the symbol body so subsequent hops
  // can keep resolving locally or follow imports into other files.
  let frontier: Array<{ readonly entry: SymbolEntry; readonly resolverFile: string }> = out.map(
    (e) => ({ entry: e, resolverFile: input.handler_file.file_path }),
  );

  for (let hop = 2; hop <= input.maxDepth; hop++) {
    if (visited.size >= MAX_VISITED_SYMBOLS) break;
    const next: Array<{ readonly entry: SymbolEntry; readonly resolverFile: string }> = [];

    for (const { entry, resolverFile } of frontier) {
      const expansions = expandFrontierEntry(entry, resolverFile, symbolTables, input);
      for (const exp of expansions) {
        const newEntry: SymbolEntry = {
          qualified_name: exp.qualified_name,
          import_source: exp.import_source,
          hops: hop,
          via: exp.via,
        };
        if (record(newEntry)) {
          next.push({ entry: newEntry, resolverFile: exp.nextResolverFile });
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return out as ReadonlyArray<ReachableSymbol>;
}

interface FrontierExpansion {
  readonly qualified_name: string;
  readonly import_source: string | null;
  readonly via: string;
  readonly nextResolverFile: string;
}

// Expand one frontier entry — branches on whether it's a cross-file imported symbol or a local one.
function expandFrontierEntry(
  entry: SymbolEntry,
  resolverFile: string,
  symbolTables: Map<string, FileSymbolTable>,
  input: ComputeReachabilityInput,
): ReadonlyArray<FrontierExpansion> {
  // Branch A — imported symbol → walk into target module's matching top-level symbol body.
  if (entry.import_source !== null) {
    const targetFile = resolveModuleToFile(entry.import_source, input.all_files);
    if (!targetFile) return [];
    const targetTable = symbolTables.get(targetFile.file_path);
    if (!targetTable) return [];
    const exportedName = findExportedName(entry.qualified_name, input.imports);
    if (!exportedName) return [];
    const symbolBody = targetTable.symbols.get(exportedName);
    if (!symbolBody) return [];
    return collectCalls(symbolBody, targetFile.dialect).map((inner) => ({
      qualified_name: inner,
      import_source: resolveImportSource(inner, targetFile.imports),
      via: `${entry.qualified_name} (imported from ${entry.import_source})`,
      nextResolverFile: targetFile.file_path,
    }));
  }
  // Branch B — local symbol → walk its body in the resolver file.
  const resolverTable = symbolTables.get(resolverFile);
  if (!resolverTable) return [];
  const localBody = resolverTable.symbols.get(entry.qualified_name);
  if (!localBody) return [];
  return collectCalls(localBody, resolverTable.file.dialect).map((inner) => ({
    qualified_name: inner,
    import_source: resolveImportSource(inner, resolverTable.file.imports),
    via: `${entry.qualified_name} (local in ${resolverFile})`,
    nextResolverFile: resolverFile,
  }));
}

// Build per-file symbol table from FunctionDeclarations + VariableDeclarations holding
// ArrowFunctionExpression / FunctionExpression. Python: function_definition + class methods.
function buildSymbolTable(file: ParsedFile): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (file.dialect === "babel") {
    const ast = file.raw_ast as File;
    for (const stmt of ast.program.body) {
      collectTopLevelSymbols(stmt, out);
    }
  } else if (file.dialect === "tree-sitter-python") {
    const tree = file.raw_ast as { rootNode: PySyntaxNode };
    for (const fn of tree.rootNode.descendantsOfType(["function_definition"])) {
      const name = fn.childForFieldName("name")?.text;
      if (name) out.set(name, fn);
    }
    for (const klass of tree.rootNode.descendantsOfType(["class_definition"])) {
      const className = klass.childForFieldName("name")?.text;
      const body = klass.childForFieldName("body");
      if (!className || !body) continue;
      for (const fn of body.descendantsOfType(["function_definition"])) {
        const methodName = fn.childForFieldName("name")?.text;
        if (methodName) out.set(`${className}.${methodName}`, fn);
      }
    }
  } else if (file.dialect === "tree-sitter-go") {
    // Phase 27 (RULES-GO-01): index top-level func declarations + methods by name so the BFS
    // (expandFrontierEntry Branch B) can resolve a handler's call to a local helper —
    // `func StripeWebhook(...) { verifyStripe(body, sig) }` → walk verifyStripe's body for the
    // hmac.Equal / webhook.ConstructEvent inside it (util-extracted verification, the first
    // collectCalls extension since Python).
    const tree = file.raw_ast as { rootNode: PySyntaxNode };
    for (const fn of tree.rootNode.descendantsOfType([
      "function_declaration",
      "method_declaration",
    ])) {
      const name = fn.childForFieldName("name")?.text;
      if (name) out.set(name, fn);
    }
  }
  return out;
}

function collectTopLevelSymbols(stmt: Node, out: Map<string, unknown>): void {
  if (stmt.type === "FunctionDeclaration") {
    if (stmt.id?.name) out.set(stmt.id.name, stmt);
    return;
  }
  if (stmt.type === "VariableDeclaration") {
    for (const decl of stmt.declarations) {
      const name = decl.id.type === "Identifier" ? decl.id.name : null;
      const init = decl.init;
      if (!name || !init) continue;
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
        out.set(name, init);
      }
    }
    return;
  }
  if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
    collectTopLevelSymbols(stmt.declaration, out);
    return;
  }
  if (stmt.type === "ExportDefaultDeclaration") {
    const decl = stmt.declaration;
    if (decl.type === "FunctionDeclaration" && decl.id?.name) {
      out.set(decl.id.name, decl);
    }
  }
}

function collectCalls(body: unknown, dialect: ParsedFile["dialect"]): ReadonlyArray<string> {
  if (dialect === "babel") return collectCallsBabel(body as Node);
  if (dialect === "tree-sitter-python") return collectCallsPython(body);
  if (dialect === "tree-sitter-go") return collectCallsGo(body);
  return [];
}

function collectCallsBabel(root: Node): ReadonlyArray<string> {
  const out: string[] = [];
  walkBabelAst(root, (node) => {
    if (node.type !== "CallExpression") return;
    const qn = qnameBabel(node.callee);
    if (!qn) return;
    out.push(qn);
    // RULES-02: surface the HMAC digest algorithm as a reachable symbol. Node's
    // `crypto.createHmac('sha256', …)` passes the algorithm as a STRING LITERAL, whereas
    // Python's `hmac.new(…, hashlib.sha256)` exposes it as a member-access symbol. Without
    // this the JS algorithm is invisible to wrong-hmac-algorithm, which then treats every
    // manual-HMAC handler as "algorithm undetermined" and mis-fires a manual-review. Emitting
    // `crypto.<algo>` lets the rule confirm SHA-256 (no finding) and still catch MD5/SHA-1.
    if (qn === "createHmac" || qn.endsWith(".createHmac")) {
      const first = node.arguments[0];
      if (first && first.type === "StringLiteral") {
        const algo = first.value.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (algo) out.push(`crypto.${algo}`);
      }
    }
  });
  return out;
}

function qnameBabel(node: Expression | Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = qnameBabel(node.object);
    const prop = node.property;
    if (!obj) return null;
    if (prop.type === "Identifier") return `${obj}.${prop.name}`;
  }
  return null;
}

function collectCallsPython(body: unknown): ReadonlyArray<string> {
  if (!body || typeof body !== "object") return [];
  const node = body as Partial<PySyntaxNode>;
  if (typeof node.descendantsOfType !== "function") return [];
  const out: string[] = [];
  for (const c of node.descendantsOfType(["call"])) {
    const fn = c.childForFieldName("function");
    if (fn?.text) out.push(fn.text);
  }
  return out;
}

// Phase 27 (RULES-GO-01): mirrors collectCallsPython for the Go grammar. A Go call is a
// `call_expression` whose `function` field is either a plain identifier (`verifyStripe(...)`) or a
// `selector_expression` (`webhook.ConstructEvent(...)`, `next.ServeHTTP(...)`, `hmac.Equal(...)`).
// For selectors the qualified name is `operand.text + "." + field.text` so package-qualified SDK
// verify calls resolve against the catalog (webhook.ConstructEvent / github.ValidatePayload), and
// `next.ServeHTTP` surfaces the middleware-wrapper continuation as a reachable symbol.
function collectCallsGo(body: unknown): ReadonlyArray<string> {
  if (!body || typeof body !== "object") return [];
  const node = body as Partial<PySyntaxNode>;
  if (typeof node.descendantsOfType !== "function") return [];
  const out: string[] = [];
  for (const c of node.descendantsOfType(["call_expression"])) {
    const fn = c.childForFieldName("function");
    if (!fn) continue;
    if (fn.type === "selector_expression") {
      const operand = fn.childForFieldName("operand");
      const field = fn.childForFieldName("field");
      if (field?.text) out.push(operand?.text ? `${operand.text}.${field.text}` : field.text);
    } else if (fn.text) {
      out.push(fn.text);
    }
  }
  return out;
}

function resolveImportSource(
  qualifiedName: string,
  imports: ReadonlyArray<ImportEdge>,
): string | null {
  // qualified_name like `stripe.webhooks.constructEvent` — root identifier is `stripe`.
  const root = qualifiedName.split(".")[0];
  if (!root) return null;
  for (const edge of imports) {
    for (const name of edge.imported_names) {
      if (name.local === root) return edge.to_module;
    }
  }
  return null;
}

function findExportedName(
  qualifiedName: string,
  imports: ReadonlyArray<ImportEdge>,
): string | null {
  // Map local name back to its source-side export name (e.g. `cd` → `compare_digest`
  // when imported via `from hmac import compare_digest as cd`).
  const root = qualifiedName.split(".")[0];
  if (!root) return null;
  for (const edge of imports) {
    for (const name of edge.imported_names) {
      if (name.local === root) return name.source === "default" ? root : name.source;
    }
  }
  return null;
}

function resolveModuleToFile(
  moduleName: string,
  allFiles: ReadonlyArray<ParsedFile>,
): ParsedFile | null {
  // Best-effort lookup: relative paths only. Bare module names (e.g. `express`) live in
  // node_modules — outside the scanned tree — so cannot be followed. Symbol stays as an
  // external leaf with import_source set, which is what rules need for D-34 set-lookup.
  if (!moduleName.startsWith(".") && !moduleName.startsWith("/")) return null;
  // Strip leading ./ or ../, then drop any source-file extension so ESM-style imports
  // (`./foo.js` → src `./foo.ts`) and bare imports (`./foo`) both resolve.
  const noLead = moduleName.replace(/^\.\.?\//, "").replace(/^\.\//, "");
  const stem = noLead.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs|py)$/i, "");
  for (const f of allFiles) {
    if (f.file_path === noLead) return f;
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]) {
      if (f.file_path.endsWith(`${stem}${ext}`)) return f;
    }
    for (const indexFile of ["/index.ts", "/index.js", "/index.tsx", "/index.jsx"]) {
      if (f.file_path.endsWith(`${stem}${indexFile}`)) return f;
    }
  }
  return null;
}
