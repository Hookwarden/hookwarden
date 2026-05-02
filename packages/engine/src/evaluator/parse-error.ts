// D-27 + ENGINE-07: every file with parse_error produces exactly ONE Finding.
// rule_id is engine-internal: "engine/parse-error". Severity high (locked). State manual-review
// (the engine cannot say verified/not-verified about a file it can't parse).

import { computeFindingId, computePrimaryLocationLineHash } from "../findings/fingerprint.js";
import { redactSnippet } from "../redaction/structural.js";
import type { Finding } from "../types/finding.js";
import type { ParsedFile } from "../types/project-model.js";

export async function buildParseErrorFinding(file: ParsedFile): Promise<Finding> {
  if (file.parse_error === null) {
    throw new Error("buildParseErrorFinding called on a file without parse_error");
  }
  const { line, col } = file.parse_error.location;
  // Snippet: the source line where the parse failed, with literals redacted (D-39).
  // We can't extract literals without a parse, so we redact the whole line as a single placeholder.
  const lines = file.source_text.split(/\r?\n/);
  const lineText = lines[Math.max(0, line - 1)] ?? "";
  const snippet = redactSnippet({
    source_text: lineText,
    literals: [{ kind: "string", start: 0, end: lineText.length, value: lineText }],
  });
  const primaryLocationLineHash = await computePrimaryLocationLineHash({
    rule_id: "engine/parse-error",
    file_path: file.file_path,
    node_kind: "ParseError",
    line_text: lineText,
  });
  const id = await computeFindingId({
    rule_id: "engine/parse-error",
    handler_id: null,
    file_path: file.file_path,
    primary_location_line_hash: primaryLocationLineHash,
  });
  return {
    id,
    rule_id: "engine/parse-error",
    provider: "unknown",
    severity: "high",
    state: "manual-review",
    file_path: file.file_path,
    location: { line, col, end_line: line, end_col: col + 1 },
    snippet,
    handler_id: null,
    primary_location_line_hash: primaryLocationLineHash,
    message: file.parse_error.message,
    metadata: { source: file.parse_error.source },
  };
}
