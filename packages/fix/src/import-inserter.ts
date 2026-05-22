// Phase 8.2 D-11 condition 4: atomic import insertion.
//
// Walks the parsedFile.imports list to find an idempotent insertion point.
// Returns null when the import is already present.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ParsedFile } from "@hookwarden/engine";
import type { FixEdit, ImportToAdd } from "./index.js";

const IMPORT_INSERTER_RULE_ID = "@import-inserter";

export function insertImports(
  parsedFile: ParsedFile,
  imports: ReadonlyArray<ImportToAdd>,
): ReadonlyArray<FixEdit> {
  const out: FixEdit[] = [];
  for (const imp of imports) {
    const edit = insertSingleImport(parsedFile, imp);
    if (edit !== null) out.push(edit);
  }
  return out;
}

function insertSingleImport(parsedFile: ParsedFile, imp: ImportToAdd): FixEdit | null {
  if (parsedFile.dialect === "babel") {
    return insertJsImport(parsedFile, imp);
  }
  if (parsedFile.dialect === "tree-sitter-python") {
    return insertPythonImport(parsedFile, imp);
  }
  // PHP — v0.5 codegens don't need imports (hash_equals, getenv are core).
  return null;
}

function insertJsImport(parsedFile: ParsedFile, imp: ImportToAdd): FixEdit | null {
  if (imp.specifier === undefined || imp.default_name === undefined) return null;
  // Idempotence check.
  for (const edge of parsedFile.imports) {
    if (edge.to_module === imp.specifier && edge.is_default) {
      const hasName = edge.imported_names.some(
        (n) => n.local === imp.default_name && n.source === "default",
      );
      if (hasName) return null;
    }
  }
  const source = parsedFile.source_text;
  const insertionByte = findJsInsertionByte(source);
  const after = `import ${imp.default_name} from "${imp.specifier}";\n`;
  return buildEdit(parsedFile, insertionByte, after);
}

function insertPythonImport(parsedFile: ParsedFile, imp: ImportToAdd): FixEdit | null {
  if (imp.module === undefined) return null;
  for (const edge of parsedFile.imports) {
    if (edge.to_module === imp.module) return null;
  }
  const insertionByte = findPythonInsertionByte(parsedFile.source_text);
  const after = `import ${imp.module}\n`;
  return buildEdit(parsedFile, insertionByte, after);
}

function findJsInsertionByte(source: string): number {
  // After shebang if present, else byte 0. The orchestrator computes import
  // ordering relative to existing imports; this function only chooses the
  // safe leading insertion point.
  if (source.startsWith("#!")) {
    const nl = source.indexOf("\n");
    return nl === -1 ? source.length : nl + 1;
  }
  return 0;
}

function findPythonInsertionByte(source: string): number {
  // Walk lines from the top; skip docstring (triple-quoted opening at line 1)
  // and `from __future__` imports. Insert after the first import block. For
  // v0.5 simplicity, insert at byte 0 — Plan 11's YAML population won't trigger
  // these for the manual-only Python rules.
  if (source.startsWith('"""') || source.startsWith("'''")) {
    // Find closing triple quote.
    const opener = source.slice(0, 3);
    const closer = source.indexOf(opener, 3);
    if (closer === -1) return 0;
    const nl = source.indexOf("\n", closer + 3);
    return nl === -1 ? source.length : nl + 1;
  }
  return 0;
}

function buildEdit(parsedFile: ParsedFile, insertionByte: number, after: string): FixEdit {
  return {
    ruleId: IMPORT_INSERTER_RULE_ID,
    routineId: IMPORT_INSERTER_RULE_ID,
    filePath: parsedFile.file_path,
    startByte: insertionByte,
    endByte: insertionByte,
    start: { line: 1, col: 1 },
    end: { line: 1, col: 1 },
    before: "",
    after,
    safety: "safe",
  };
}
