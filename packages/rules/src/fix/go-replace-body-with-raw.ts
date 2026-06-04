// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 27 (FIX-GO-01 #2) — Go raw-body-misuse codegen.
//
// The Go misuse shape is decoding the request body as the signing input —
// `json.NewDecoder(r.Body).Decode(&x)` / `json.Unmarshal(buf, &x)` / gin's
// `c.ShouldBindJSON(&x)` — instead of HMACing the RAW bytes. The correct fix
// captures `body, _ := io.ReadAll(r.Body)` ONCE and reuses `body` for both the
// MAC and the decode. That is a multi-statement restructure (read-before-decode
// + reuse the bytes), NEVER a clean single-range substitution (Assumption A3).
//
// Therefore this routine classifies CONSERVATIVELY as safety:"manual-only": it
// localizes the misuse and surfaces the io.ReadAll(r.Body) pattern as guidance,
// but does NOT auto-apply a risky edit. (Promotion to "safe" for any provably
// clean single-range shape is left to a future revision once the 27-05 FP corpus
// shows a reliably-detectable narrow case.)

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";
import type { Node as TsNode } from "web-tree-sitter";

const ROUTINE_ID = "go-replace-body-with-raw";

// The corrected pattern a developer should adopt — surfaced as manual-only guidance.
const RAW_BODY_READ = "io.ReadAll(r.Body)";

export function goReplaceBodyWithRaw(parsedFile: ParsedFile, finding: Finding): FixEdit | null {
  if (parsedFile.dialect !== "tree-sitter-go") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  const lineSource = sliceLine(parsedFile.source_text, finding.location.line);
  if (lineSource.includes(RAW_BODY_READ)) return null; // already reads raw bytes

  const tree = parsedFile.raw_ast as { readonly rootNode: TsNode };
  const node = findBodyMisuseTarget(tree.rootNode, finding.location.line);
  if (node === null) return null;
  const source = parsedFile.source_text;
  const before = source.slice(node.startIndex, node.endIndex);

  return {
    ruleId: finding.rule_id,
    routineId: ROUTINE_ID,
    filePath: parsedFile.file_path,
    startByte: node.startIndex,
    endByte: node.endIndex,
    start: { line: node.startPosition.row + 1, col: node.startPosition.column + 1 },
    end: { line: node.endPosition.row + 1, col: node.endPosition.column + 1 },
    before,
    // Manual-only guidance: read the raw bytes once and HMAC them, then json.Unmarshal(body, &x).
    after: `/* read raw bytes for the signature, then decode: body, _ := ${RAW_BODY_READ} */`,
    safety: "manual-only",
  };
}

// Locate a body-decode call within the handler's line span (the finding anchors to the handler
// declaration; the decode lives in the body): json.NewDecoder(r.Body).Decode(...), json.Unmarshal(...),
// or gin/echo ShouldBindJSON/BindJSON/Bind. Returns the first such call (manual-only guidance, so a
// single representative target is sufficient — the developer restructures the read regardless).
function findBodyMisuseTarget(root: TsNode, findingLine: number): TsNode | null {
  let handlerEndLine = findingLine;
  const candidates: TsNode[] = [];
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const startLine = node.startPosition.row + 1;
    if (startLine === findingLine && node.endPosition.row + 1 > handlerEndLine) {
      handlerEndLine = node.endPosition.row + 1;
    }
    if (node.type === "call_expression") {
      const t = node.text;
      if (
        /\bjson\.NewDecoder\s*\([^)]*\.Body\s*\)\.Decode\b/.test(t) ||
        /\bjson\.Unmarshal\s*\(/.test(t) ||
        /\.(ShouldBindJSON|BindJSON|Bind)\s*\(/.test(t)
      ) {
        candidates.push(node);
      }
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child !== null) stack.push(child);
    }
  }
  const inHandler = candidates
    .filter((n) => {
      const line = n.startPosition.row + 1;
      return line >= findingLine && line <= handlerEndLine;
    })
    .sort((a, b) => a.startIndex - b.startIndex);
  return inHandler[0] ?? null;
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
