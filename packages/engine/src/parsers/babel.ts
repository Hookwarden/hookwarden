// JS/TS parser adapter (ENGINE-01). Calls @babel/parser, normalizes the result into ParsedFile.
// Engine-pure: NO fs / http / net / process — caller hands us source_text.
// D-27 all-or-nothing: any parse error short-circuits to a ParseErrorRecord with empty imports.
// Plugin set is permissive per phase-2 Claude's Discretion; Phase 6 will tighten against the 200+ corpus.

import { type ParserPlugin, parse } from "@babel/parser";
import type { File, ImportDeclaration, Node } from "@babel/types";
import type { ImportEdge, ParsedFile, ParseErrorRecord } from "../types/project-model.js";

export interface ParseJsTsInput {
  readonly file_path: string; // repo-relative
  readonly source_text: string;
  // ENGINE auto-selects plugins by extension; caller may force a hint.
  readonly hint?: "ts" | "tsx" | "js" | "jsx";
}

const TS_FAMILY: ReadonlyArray<ParserPlugin> = [
  "typescript",
  "decorators-legacy",
  "topLevelAwait",
  "importAttributes",
  "explicitResourceManagement",
];

const JS_FAMILY: ReadonlyArray<ParserPlugin> = [
  "decorators-legacy",
  "topLevelAwait",
  "importAttributes",
  "explicitResourceManagement",
];

const JSX_FAMILY: ReadonlyArray<ParserPlugin> = ["jsx"];

function pluginsFor(hint: ParseJsTsInput["hint"], filePath: string): ReadonlyArray<ParserPlugin> {
  const ext = (hint ?? filePath.split(".").pop() ?? "").toLowerCase();
  const isTs = ext === "ts" || ext === "tsx";
  // Enable JSX for .jsx/.tsx (explicit) AND for .js/.mjs/.cjs (Next.js convention:
  // pages/_app.js + pages/_document.js contain JSX in .js by framework default).
  // Per Babel docs, the `jsx` plugin does not change parsing of non-JSX code, so
  // enabling it for all JS-family extensions is safe. NOT enabled for plain .ts
  // because it would conflict with angle-bracket type assertions like `<Type>(expr)`
  // — TypeScript itself requires the explicit .tsx extension to enable JSX.
  const isExplicitJsx = ext === "tsx" || ext === "jsx";
  const isJsFamily = ext === "js" || ext === "mjs" || ext === "cjs";
  const enableJsx = isExplicitJsx || (!isTs && isJsFamily);
  const out: ParserPlugin[] = isTs ? [...TS_FAMILY] : [...JS_FAMILY];
  if (enableJsx) out.push(...JSX_FAMILY);
  return out;
}

function languageFor(hint: ParseJsTsInput["hint"], filePath: string): "javascript" | "typescript" {
  const ext = (hint ?? filePath.split(".").pop() ?? "").toLowerCase();
  return ext === "ts" || ext === "tsx" ? "typescript" : "javascript";
}

export async function parseJsTs(input: ParseJsTsInput): Promise<ParsedFile> {
  const { file_path, source_text } = input;
  const plugins = pluginsFor(input.hint, file_path);
  const language = languageFor(input.hint, file_path);
  let ast: File | null = null;
  let parseError: ParseErrorRecord | null = null;
  try {
    ast = parse(source_text, {
      sourceType: "module",
      plugins: plugins as ParserPlugin[],
      errorRecovery: false, // D-27: we want the throw, not a partial tree
      tokens: false,
      ranges: false,
      attachComment: false,
      allowReturnOutsideFunction: false,
    });
  } catch (err) {
    // Babel's SyntaxError carries .loc = { line, column } (1-indexed line, 0-indexed column).
    const e = err as { message?: string; loc?: { line?: number; column?: number } } | undefined;
    parseError = {
      message: e?.message ?? "babel parse error",
      location: { line: e?.loc?.line ?? 1, col: (e?.loc?.column ?? 0) + 1 },
      source: "babel",
    };
  }
  // D-27: when parse_error is set, downstream rules MUST NOT inspect raw_ast — return empty imports.
  const imports: ReadonlyArray<ImportEdge> = ast === null ? [] : extractImports(ast, file_path);
  return {
    file_path,
    language,
    dialect: "babel",
    source_text,
    raw_ast: ast,
    imports,
    parse_error: parseError,
  };
}

function extractImports(ast: File, fromFile: string): ReadonlyArray<ImportEdge> {
  const out: ImportEdge[] = [];
  for (const stmt of ast.program.body) {
    // ES module imports: import { a, b as c } from 'x'; import d from 'x'; import * as ns from 'x';
    if (stmt.type === "ImportDeclaration") {
      out.push(toImportEdge(stmt, fromFile));
      continue;
    }
    // CJS interop: const x = require('y'); top-level only.
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations) {
        if (decl.init?.type !== "CallExpression") continue;
        const callee = decl.init.callee;
        if (callee.type !== "Identifier" || callee.name !== "require") continue;
        const arg = decl.init.arguments[0];
        if (!arg || arg.type !== "StringLiteral") continue;
        const local = decl.id.type === "Identifier" ? decl.id.name : "<destructured>";
        out.push({
          from_file: fromFile,
          to_module: arg.value,
          imported_names: [{ local, source: "default" }],
          is_default: true,
        });
      }
    }
  }
  return out;
}

function toImportEdge(node: ImportDeclaration, fromFile: string): ImportEdge {
  const toModule = node.source.value;
  const names: Array<{ local: string; source: string }> = [];
  let isDefault = false;
  for (const spec of node.specifiers) {
    if (spec.type === "ImportDefaultSpecifier") {
      isDefault = true;
      names.push({ local: spec.local.name, source: "default" });
    } else if (spec.type === "ImportSpecifier") {
      const importedName =
        spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
      names.push({ local: spec.local.name, source: importedName });
    } else if (spec.type === "ImportNamespaceSpecifier") {
      names.push({ local: spec.local.name, source: "*" });
    }
  }
  return { from_file: fromFile, to_module: toModule, imported_names: names, is_default: isDefault };
}

// Re-export for narrow downstream use (e.g. evaluator dispatching on AST node kind).
export type BabelFile = File;
export type BabelNode = Node;
