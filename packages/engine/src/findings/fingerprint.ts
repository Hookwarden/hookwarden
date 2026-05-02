import { sha256Hex } from "./webcrypto.js";

// SARIF 2.1.0 partialFingerprints.primaryLocationLineHash semantic:
// - stable across unrelated line shifts in the same file
// - input includes the rule id, file path, AST node kind, and a normalized version of the line text
// - hex-encoded sha256 is GitHub Code Scanning's accepted format
//
// We normalize the line text by collapsing runs of whitespace to single spaces and trimming.
// This means cosmetic reformatting does not change identity, but a real edit does.
function normalizeLine(text: string): string {
  return text.replace(/[ \t]+/g, " ").trim();
}

export interface PrimaryLocationLineHashInput {
  readonly rule_id: string;
  readonly file_path: string;
  readonly node_kind: string; // e.g. "CallExpression", "FunctionDeclaration"
  readonly line_text: string; // the source text of the primary line
}

export async function computePrimaryLocationLineHash(
  input: PrimaryLocationLineHashInput,
): Promise<string> {
  const canonical = [
    input.rule_id,
    input.file_path,
    input.node_kind,
    normalizeLine(input.line_text),
  ].join("|");
  return sha256Hex(canonical);
}

// D-37 composite stable inventory id.
// id = sha256(file_path|route_pattern|http_methods_sorted.join(',')|handler_function_name ?? '<anonymous>')
export interface HandlerIdInput {
  readonly file_path: string;
  readonly route_pattern: string;
  readonly http_methods: ReadonlyArray<string>;
  readonly handler_function_name: string | null;
}

export async function computeHandlerId(input: HandlerIdInput): Promise<string> {
  const methodsSorted = [...input.http_methods]
    .map((m) => m.toUpperCase())
    .sort()
    .join(",");
  const fnName = input.handler_function_name ?? "<anonymous>";
  const canonical = `${input.file_path}|${input.route_pattern}|${methodsSorted}|${fnName}`;
  return sha256Hex(canonical);
}

// Composite Finding.id — stable per (rule, handler, primary location).
// Used for Phase 8 SaaS scan-to-scan diffing.
export interface FindingIdInput {
  readonly rule_id: string;
  readonly handler_id: string | null; // null for parse-error findings
  readonly file_path: string;
  readonly primary_location_line_hash: string;
}

export async function computeFindingId(input: FindingIdInput): Promise<string> {
  const canonical = [
    input.rule_id,
    input.handler_id ?? "<no-handler>",
    input.file_path,
    input.primary_location_line_hash,
  ].join("|");
  return sha256Hex(canonical);
}
