// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #4 (Python missing-secret-presence-check codegen).
//
// Safety claim (D-11): same as the JS/TS variant; emits `if not os.environ.get(VAR):`
// early-raise pattern.

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";

const ROUTINE_ID = "python-insert-secret-presence-check";

export function pythonInsertSecretPresenceCheck(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "tree-sitter-python") return null;
  if (parsedFile.parse_error !== null) return null;
  const source = parsedFile.source_text;
  const targetLine = finding.location.line;
  const lineSource = sliceLine(source, targetLine);
  const prevLineSource = targetLine > 1 ? sliceLine(source, targetLine - 1) : "";
  if (/if\s+not\s+os\.environ/.test(prevLineSource) || /if\s+not\s+os\.environ/.test(lineSource)) {
    return null;
  }
  const envVar = extractEnvVar(lineSource);
  if (envVar === null) return null;
  const insertionByte = lineStartByte(source, targetLine);
  if (insertionByte === null) return null;
  const indent = lineSource.match(/^[ \t]*/)?.[0] ?? "";
  const after = `${indent}if not os.environ.get("${envVar}"):\n${indent}    raise RuntimeError("${envVar} is not set")\n`;
  return {
    ruleId: finding.rule_id,
    routineId: ROUTINE_ID,
    filePath: parsedFile.file_path,
    startByte: insertionByte,
    endByte: insertionByte,
    start: { line: targetLine, col: 1 },
    end: { line: targetLine, col: 1 },
    before: "",
    after,
    safety: "safe",
  };
}

function extractEnvVar(lineSource: string): string | null {
  const match =
    lineSource.match(/os\.environ\.get\(["']([A-Z][A-Z0-9_]*)["']\)/) ??
    lineSource.match(/os\.environ\[["']([A-Z][A-Z0-9_]*)["']\]/) ??
    lineSource.match(/os\.getenv\(["']([A-Z][A-Z0-9_]*)["']\)/);
  return match?.[1] ?? null;
}

function lineStartByte(source: string, line: number): number | null {
  if (line <= 1) return 0;
  let currentLine = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 0x0a) {
      currentLine++;
      if (currentLine === line) return i + 1;
    }
  }
  return null;
}

function sliceLine(source: string, line: number): string {
  let currentLine = 1;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (currentLine === line) {
      const nl = source.indexOf("\n", i);
      return source.slice(start, nl === -1 ? source.length : nl);
    }
    if (source.charCodeAt(i) === 0x0a) {
      currentLine++;
      start = i + 1;
    }
  }
  return "";
}
