// D-40 (revised): compact one-line header per finding, 2-space indented body.
// D-41 (revised): findings sorted by severity desc → file → line. No per-
// severity banner sections (severity is carried by the inline glyph + color
// in the header). D-42: severity color on header glyph + label. D-43:
// OSC-8 hyperlinks on file path + docs URL.
// D-58: provider_docs_url rendered with a `docs ›` accent-prefix line.
// Fix-guidance extraction: if the rule message contains a paragraph that
// begins with `Fix:` (verbatim, beginning of a line), the explanation
// (pre-Fix) is rendered as the body, and the post-Fix text becomes a
// dedicated `fix ›` action line. Falls back to message-only rendering
// for rules without a `Fix:` paragraph.
//
// Pure: returns a single string. CLI shell (Plan 07) is the only place that writes to stdout.

import * as path from "node:path";
import type { Finding, RuleDefinition, RuleSet, ScanResult, Severity } from "@hookwarden/engine";
import { actionPrefix, ansiLink, dim, severityHeaderInline, stateText } from "./colors.js";

export interface RenderFindingsOptions {
  readonly useAnsi: boolean;
  readonly cwd: string;
}

// Severity rank for sort; lower number = higher severity (sorted first).
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function indexRules(ruleSet: RuleSet | null): Map<string, RuleDefinition> {
  const m = new Map<string, RuleDefinition>();
  if (ruleSet === null) return m;
  for (const r of ruleSet.rules) m.set(r.rule_id, r);
  return m;
}

function compareFindings(a: Finding, b: Finding): number {
  // Severity desc first (critical before info).
  const sa = SEVERITY_RANK[a.severity];
  const sb = SEVERITY_RANK[b.severity];
  if (sa !== sb) return sa - sb;
  if (a.file_path !== b.file_path) return a.file_path < b.file_path ? -1 : 1;
  if (a.location.line !== b.location.line) return a.location.line - b.location.line;
  if (a.location.col !== b.location.col) return a.location.col - b.location.col;
  if (a.rule_id < b.rule_id) return -1;
  if (a.rule_id > b.rule_id) return 1;
  return 0;
}

/**
 * Split a rule message into {explanation, fix}. The convention across the
 * rule pack is a paragraph beginning with `Fix:` (case-sensitive, at the
 * start of a line, optionally preceded by a blank line). If no such
 * paragraph exists, the whole message is the explanation and fix is null.
 */
function splitMessage(raw: string): { explanation: string; fix: string | null } {
  // Match a paragraph break followed by "Fix:" at the start of a line.
  // Capture everything before as explanation, everything after the "Fix:"
  // marker (sans the marker itself) as fix.
  // Accepts "Fix:" and qualified variants like "Fix (Express):" / "Fix (Node):"
  // so a framework-scoped fix paragraph still becomes a clean `fix ›` line
  // instead of being buried in the explanation prose.
  const match = raw.match(/^([\s\S]*?)(?:\n\s*\n|\n)Fix(?:\s*\([^)]*\))?:\s*([\s\S]*)$/);
  if (match === null) {
    return { explanation: collapseWhitespace(raw), fix: null };
  }
  const explanation = collapseWhitespace(match[1] ?? "");
  const fix = collapseWhitespace(match[2] ?? "");
  return { explanation, fix: fix.length === 0 ? null : fix };
}

/**
 * Collapse rule-message whitespace for compact rendering: replace runs of
 * spaces/newlines with a single space, trim. The original messages are
 * paragraph-wrapped at ~75 cols which produces awkward indented re-wraps
 * in narrow terminals; we let the terminal own line wrapping at runtime.
 */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Soft-wrap a long single line to a target column at word boundaries,
 * prefixing every output line with `indent`. Preserves words that exceed
 * the column width (URLs, long identifiers) — wraps to the next line
 * rather than truncating mid-token.
 */
function softWrap(text: string, indent: string, maxCol: number): string[] {
  const available = Math.max(20, maxCol - indent.length);
  const words = text.split(" ");
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length === 0) {
      line = w;
      continue;
    }
    if (line.length + 1 + w.length <= available) {
      line = `${line} ${w}`;
    } else {
      out.push(`${indent}${line}`);
      line = w;
    }
  }
  if (line.length > 0) out.push(`${indent}${line}`);
  return out;
}

function renderFinding(
  f: Finding,
  rule: RuleDefinition | undefined,
  opts: RenderFindingsOptions,
): string {
  const absPath = path.resolve(opts.cwd, f.file_path);
  const locText = `${f.file_path}:${f.location.line}:${f.location.col}`;
  const fileLink = ansiLink(
    `file://${absPath}:${f.location.line}:${f.location.col}`,
    locText,
    opts,
  );

  // Header: `<glyph> <severity>  <file:line:col>  <rule_id>  <state>`
  // Severity column is 10 chars wide (glyph + 8-pad label + 1 space);
  // state column right-floats. Two spaces between columns for scan-readability.
  const sevCol = severityHeaderInline(f.severity, opts);
  const stateCol = stateText(f.state, opts);
  const header = `${sevCol}  ${fileLink}  ${dim(f.rule_id, opts)}  ${stateCol}`;

  const lines: string[] = [header];
  const indent = "  ";
  // 110 cols matches GitHub's diff-view column width and keeps common
  // Stripe/GitHub doc quotes intact on a single line. The original
  // multi-line rule messages are collapsed first so we re-flow the
  // text ourselves rather than reusing their 75-col paragraph wrap.
  const wrapCol = 110;

  // Body: explanation + (optional) fix line.
  const { explanation, fix } = splitMessage(f.message);
  if (explanation.length > 0) {
    lines.push(...softWrap(explanation, indent, wrapCol));
  }
  if (fix !== null) {
    const fixPrefix = actionPrefix("fix", opts);
    // First line carries the prefix; continuation lines indent past it.
    const fixWrapped = softWrap(fix, "", wrapCol - 6); // 6 = "fix › " width
    if (fixWrapped.length > 0) {
      lines.push(`${indent}${fixPrefix} ${fixWrapped[0]?.trim() ?? ""}`);
      for (let i = 1; i < fixWrapped.length; i += 1) {
        lines.push(`${indent}      ${fixWrapped[i]?.trim() ?? ""}`);
      }
    }
  }

  // Docs link.
  if (rule?.provider_docs_url) {
    const docsPrefix = actionPrefix("docs", opts);
    const linked = ansiLink(rule.provider_docs_url, rule.provider_docs_url, opts);
    lines.push(`${indent}${docsPrefix} ${linked}`);
  }

  return lines.join("\n");
}

export function renderFindings(
  result: ScanResult,
  ruleSet: RuleSet | null,
  opts: RenderFindingsOptions,
): string {
  if (result.findings.length === 0) return "No findings.\n";
  const rulesByID = indexRules(ruleSet);
  // Severity-desc → file → line. No banner sections — every finding stands
  // on its own one-line header with the severity glyph + color.
  const sorted = [...result.findings].sort(compareFindings);
  const rendered = sorted.map((f) => renderFinding(f, rulesByID.get(f.rule_id), opts));
  // Single blank line between findings; trailing newline so the summary
  // footer renders flush against a clean blank.
  return `${rendered.join("\n\n")}\n\n`;
}
