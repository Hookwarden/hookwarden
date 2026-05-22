// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #4 (JS/TS missing-secret-presence-check codegen).
//
// Safety claim (D-11):
//   1. Local: YES (single statement insertion at line above secret usage)
//   2. Semantic-preserving: YES (early throw on missing env var is canonical)
//   3. Strengthens security: YES (rejects misconfigured environments loudly)
//   4. No new imports: YES (process.env is global; Error is global)
//   5. No type errors: YES

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";

const ROUTINE_ID = "typescript-insert-secret-presence-check";

export function typescriptInsertSecretPresenceCheck(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "babel") return null;
  if (parsedFile.parse_error !== null) return null;
  const source = parsedFile.source_text;
  const targetLine = finding.location.line;
  const lineSource = sliceLine(source, targetLine);
  // Defense: skip if a guard is already present on the line or one line above.
  const prevLineSource = targetLine > 1 ? sliceLine(source, targetLine - 1) : "";
  if (
    /if\s*\(\s*!\s*process\.env/.test(prevLineSource) ||
    /if\s*\(\s*!\s*process\.env/.test(lineSource)
  ) {
    return null;
  }
  const envVar = extractEnvVar(lineSource);
  if (envVar === null) return null;
  const insertionByte = lineStartByte(source, targetLine);
  if (insertionByte === null) return null;
  const indent = lineSource.match(/^[ \t]*/)?.[0] ?? "";
  const after = `${indent}if (!process.env.${envVar}) throw new Error("${envVar} is not set");\n`;
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
  // Match `process.env.FOO_BAR` (member access).
  const memberMatch = lineSource.match(/process\.env\.([A-Z][A-Z0-9_]*)/);
  if (memberMatch !== null) return memberMatch[1] ?? null;
  // Match `process.env["FOO_BAR"]` (bracket access).
  const bracketMatch = lineSource.match(/process\.env\["([A-Z][A-Z0-9_]*)"\]/);
  if (bracketMatch !== null) return bracketMatch[1] ?? null;
  return null;
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
