// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #3 (JS/TS raw-body-misuse codegen).
//
// Safety claim (D-11):
//   1. Local: YES (single member-access replacement)
//   2. Semantic-preserving: YES (req.rawBody is the documented Express raw-body
//      property when express.raw() middleware is registered; the rule's emit
//      condition implies the user is already calling HMAC over req.body bytes)
//   3. Strengthens security: YES (signature was computed over the raw bytes;
//      using parsed JSON would mis-verify in the presence of key reordering or
//      whitespace normalisation)
//   4. No new imports: YES (req is parameter; rawBody is a Buffer property)
//   5. No type errors: YES (express types include rawBody?: Buffer)

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";

const ROUTINE_ID = "typescript-replace-req-body-with-raw-body";

interface BabelNodeLike {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
  readonly object?: BabelNodeLike & { name?: string };
  readonly property?: BabelNodeLike & { name?: string };
  readonly computed?: boolean;
}

export function typescriptReplaceReqBodyWithRawBody(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "babel") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  const node = findReqBodyMember(parsedFile.raw_ast, finding.location.line);
  if (node === null) return null;
  if (
    typeof node.start !== "number" ||
    typeof node.end !== "number" ||
    !node.object ||
    !node.property
  ) {
    return null;
  }
  // Already rewritten? Defense in depth.
  if (node.property.name === "rawBody") return null;
  const source = parsedFile.source_text;
  const before = source.slice(node.start, node.end);
  const objSource = source.slice(node.object.start ?? 0, node.object.end ?? 0);
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
    after: `${objSource}.rawBody`,
    safety: "safe",
  };
}

function findReqBodyMember(root: unknown, targetLine: number): BabelNodeLike | null {
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
    if (
      n.type === "MemberExpression" &&
      n.loc?.start.line === targetLine &&
      n.computed === false &&
      n.property?.name === "body"
    ) {
      return n;
    }
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "extra") continue;
      const child = n[key];
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  return null;
}
