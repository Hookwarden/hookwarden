// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #1 (JS/TS timing-unsafe-comparison codegen).
//
// Safety claim (D-11):
//   1. Local — single contiguous byte range within one expression: YES
//   2. Semantic-preserving for non-pathological inputs: YES (timingSafeEqual returns
//      boolean like ===; both operands are wrapped in Buffer.from for type compatibility)
//   3. Strengthens security: YES (constant-time comparison closes the timing channel)
//   4. No new imports needed: NO — emits importsToAdd=[{specifier:"node:crypto",
//      default_name:"crypto"}] when crypto is not already imported
//   5. No type errors: YES (timingSafeEqual signature accepts Buffer; Buffer.from(string)
//      inferred; runtime accepts both strings and existing Buffers)

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";

interface BabelNodeLike {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
  readonly operator?: string;
  readonly left?: BabelNodeLike;
  readonly right?: BabelNodeLike;
}

const RULE_OPERATORS: ReadonlySet<string> = new Set(["==", "==="]);
const ROUTINE_ID = "typescript-replace-binary-equality";

export function typescriptReplaceBinaryEquality(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "babel") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  // The finding is anchored to the handler declaration, but the insecure comparison lives
  // somewhere in the handler body — usually several lines below the route. Search the
  // handler's full line span (location.line..end_line) rather than only the finding's line;
  // otherwise the common case (a multi-line handler) never gets fixed. When the span holds
  // more than one ==/=== comparison the target is ambiguous, so we decline — a safe fixer
  // never guesses which comparison is the signature check.
  const node = findSoleBinaryInHandler(parsedFile.raw_ast, finding.location.line);
  if (node === null) return null;
  // Defense in depth: if the comparison's own line already calls timingSafeEqual, skip.
  const lineSource = sliceLine(
    parsedFile.source_text,
    node.loc?.start.line ?? finding.location.line,
  );
  if (lineSource.includes("timingSafeEqual")) return null;
  if (!node.operator || !RULE_OPERATORS.has(node.operator)) return null;
  if (
    typeof node.start !== "number" ||
    typeof node.end !== "number" ||
    !node.left ||
    !node.right ||
    typeof node.left.start !== "number" ||
    typeof node.left.end !== "number" ||
    typeof node.right.start !== "number" ||
    typeof node.right.end !== "number"
  ) {
    return null;
  }
  const source = parsedFile.source_text;
  const before = source.slice(node.start, node.end);
  const leftSrc = source.slice(node.left.start, node.left.end);
  const rightSrc = source.slice(node.right.start, node.right.end);
  const after = `crypto.timingSafeEqual(Buffer.from(${leftSrc}), Buffer.from(${rightSrc}))`;
  const importsToAdd = hasCryptoImport(parsedFile)
    ? undefined
    : ([{ specifier: "node:crypto", default_name: "crypto" }] as const);
  return {
    ruleId: finding.rule_id,
    routineId: ROUTINE_ID,
    filePath: parsedFile.file_path,
    startByte: node.start,
    endByte: node.end,
    start: {
      line: node.loc?.start.line ?? finding.location.line,
      col: (node.loc?.start.column ?? 0) + 1,
    },
    end: {
      line: node.loc?.end.line ?? finding.location.line,
      col: (node.loc?.end.column ?? 0) + 1,
    },
    before,
    after,
    safety: "safe",
    ...(importsToAdd ? { importsToAdd } : {}),
  };
}

function hasCryptoImport(parsedFile: ParsedFile): boolean {
  for (const edge of parsedFile.imports) {
    if (edge.to_module === "crypto" || edge.to_module === "node:crypto") return true;
  }
  return false;
}

// The finding's location is a single point (the handler declaration line), not a span, so we
// first derive the handler's extent: the largest end-line among AST nodes that *start* on the
// finding line — i.e. the enclosing `app.post(...)` statement, which spans the whole handler.
// We then collect every ==/=== BinaryExpression starting within [findingLine, handlerEndLine]
// and return the sole match. Zero or many ⇒ null: a safe fixer never guesses which comparison
// is the signature check.
function findSoleBinaryInHandler(root: unknown, findingLine: number): BabelNodeLike | null {
  if (root === null || root === undefined || typeof root !== "object") return null;

  let handlerEndLine = findingLine;
  const binaries: BabelNodeLike[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || node === undefined) continue;
    if (typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const n = node as BabelNodeLike & Record<string, unknown>;
    const startLine = n.loc?.start.line;
    const endLine = n.loc?.end.line;
    if (startLine === findingLine && typeof endLine === "number" && endLine > handlerEndLine) {
      handlerEndLine = endLine;
    }
    if (
      n.type === "BinaryExpression" &&
      typeof n.operator === "string" &&
      RULE_OPERATORS.has(n.operator) &&
      typeof startLine === "number"
    ) {
      binaries.push(n);
    }
    for (const key of Object.keys(n)) {
      if (
        key === "loc" ||
        key === "extra" ||
        key === "leadingComments" ||
        key === "trailingComments"
      ) {
        continue;
      }
      const child = n[key];
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }

  const inHandler = binaries.filter((b) => {
    const line = b.loc?.start.line ?? -1;
    return line >= findingLine && line <= handlerEndLine;
  });
  return inHandler.length === 1 ? (inHandler[0] ?? null) : null;
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
