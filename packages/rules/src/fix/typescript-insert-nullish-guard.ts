// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #2 (JS/TS missing-nullish-guard codegen).
//
// Safety claim (D-11):
//   1. Local: YES (single-statement insertion at start of line)
//   2. Semantic-preserving: YES (early-throw on missing signature is the
//      canonical missing-nullish-guard fix)
//   3. Strengthens security: YES (refuses to verify with a falsy signature)
//   4. No new imports: YES
//   5. No type errors: YES (typeof check is structural, no flow narrowing needed)

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";

const ROUTINE_ID = "typescript-insert-nullish-guard";

interface BabelNodeLike {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number };
  };
}

export function typescriptInsertNullishGuard(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "babel") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  const source = parsedFile.source_text;
  const targetLine = finding.location.line;
  const lineSource = sliceLine(source, targetLine);
  // Defense in depth: if a null/undefined guard already exists nearby, skip.
  if (lineSource.match(/\bif\b\s*\(\s*!/) !== null) return null;
  // Find the start byte of the finding's line — insertion point.
  const insertionByte = lineStartByte(source, targetLine);
  if (insertionByte === null) return null;
  // Identify the variable name. Look for a CallExpression on the finding line
  // and grab its first argument's identifier; default to "sig" if unknown.
  const variable = inferSignatureVariable(parsedFile.raw_ast, targetLine) ?? "sig";
  const indent = lineSource.match(/^[ \t]*/)?.[0] ?? "";
  const after = `${indent}if (!${variable}) throw new Error("Webhook signature missing");\n`;
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

function inferSignatureVariable(root: unknown, targetLine: number): string | null {
  if (root === null || root === undefined || typeof root !== "object") return null;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || node === undefined || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const n = node as BabelNodeLike & Record<string, unknown>;
    if (n.type === "CallExpression" && n.loc?.start.line === targetLine) {
      const args = (n as { arguments?: unknown }).arguments;
      if (Array.isArray(args) && args.length > 0) {
        // HMAC compare functions take (computed_hmac, user_supplied_signature).
        // The user-supplied value is the one that needs the null check — it's
        // the LAST argument.
        const last = args[args.length - 1] as { type?: string; name?: string } | undefined;
        if (last?.type === "Identifier" && typeof last.name === "string") return last.name;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "extra") continue;
      const child = n[key];
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
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
