// D-40: severity-grouped multi-line. D-41: multi-line per finding by default.
// D-42: severity color + state badge. D-58: provider_docs_url rendered as `↳ <url>`.
//
// Pure: returns a single string. CLI shell (Plan 07) is the only place that writes to stdout.

import * as path from "node:path";
import type { Finding, RuleDefinition, RuleSet, ScanResult, Severity } from "@hookwarden/engine";
import { ansiLink, dim, severityColor, severityHeader, stateBadge } from "./colors.js";

export interface RenderFindingsOptions {
  readonly useAnsi: boolean;
  readonly cwd: string;
}

const SEVERITY_ORDER: ReadonlyArray<Severity> = ["critical", "high", "medium", "low", "info"];

function indexRules(ruleSet: RuleSet | null): Map<string, RuleDefinition> {
  const m = new Map<string, RuleDefinition>();
  if (ruleSet === null) return m;
  for (const r of ruleSet.rules) m.set(r.rule_id, r);
  return m;
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.file_path !== b.file_path) return a.file_path < b.file_path ? -1 : 1;
  if (a.location.line !== b.location.line) return a.location.line - b.location.line;
  if (a.location.col !== b.location.col) return a.location.col - b.location.col;
  if (a.rule_id < b.rule_id) return -1;
  if (a.rule_id > b.rule_id) return 1;
  return 0;
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
  const lines: string[] = [];
  lines.push(`  ${fileLink}`);
  const colored = severityColor(f.severity, f.rule_id, opts);
  const badge = stateBadge(f.state, opts);
  lines.push(`    ${colored}  ${badge}`);
  // Preserve message line breaks; trim a single trailing empty line if present.
  const messageLines = f.message.split(/\r?\n/);
  if (messageLines.length > 0 && messageLines[messageLines.length - 1] === "") {
    messageLines.pop();
  }
  for (const ml of messageLines) lines.push(`    ${ml}`);
  if (rule?.provider_docs_url) {
    const arrow = "↳";
    const linked = ansiLink(rule.provider_docs_url, rule.provider_docs_url, opts);
    lines.push(`    ${dim(arrow, opts)} ${linked}`);
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
  const buckets: Record<Severity, Finding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    info: [],
  };
  for (const f of result.findings) buckets[f.severity].push(f);
  for (const k of SEVERITY_ORDER) buckets[k].sort(compareFindings);
  const sections: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    const list = buckets[sev];
    if (list.length === 0) continue;
    sections.push(severityHeader(sev, opts));
    sections.push("");
    sections.push(list.map((f) => renderFinding(f, rulesByID.get(f.rule_id), opts)).join("\n\n"));
    sections.push("");
  }
  return `${sections.join("\n")}\n`;
}
