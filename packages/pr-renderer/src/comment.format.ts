// Pure renderer for the sticky PR summary comment.
// No I/O, no Octokit, no node:* — testable in isolation.
//
// D-81: STICKY_MARKER is byte-locked. Plan grep gate enforces the exact spelling.
// D-82: top-5 findings table sorted by severity desc → file_path → line.
// D-83: callers handle silent-on-clean dispatch; this module does not post.

import type { ScanFinding } from "./types.js";

export const STICKY_MARKER = "<!-- hookwarden:pr-summary -->";

export const CLEAN_BODY = `${STICKY_MARKER}\n✅ hookwarden: no new findings`;

// T-05-03-01: identity verification literal. The default GITHUB_TOKEN posts as
// 'github-actions[bot]'. Plan grep gate enforces this exact string.
export const BOT_LOGIN = "github-actions[bot]";

interface RenderInput {
  readonly newFindings: ReadonlyArray<ScanFinding>;
  readonly findingsCount: number;
  readonly codeScanningUrl: string;
}

const SEVERITY_RANK: Record<ScanFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_ORDER: ReadonlyArray<ScanFinding["severity"]> = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

function compareFindings(a: ScanFinding, b: ScanFinding): number {
  const sa = SEVERITY_RANK[a.severity];
  const sb = SEVERITY_RANK[b.severity];
  if (sa !== sb) return sa - sb;
  if (a.file_path !== b.file_path) return a.file_path < b.file_path ? -1 : 1;
  return a.location.line - b.location.line;
}

function tabulateBySeverity(
  findings: ReadonlyArray<ScanFinding>,
): Record<ScanFinding["severity"], number> {
  const counts: Record<ScanFinding["severity"], number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    counts[f.severity] += 1;
  }
  return counts;
}

function severityTotalsLine(counts: Record<ScanFinding["severity"], number>): string {
  const parts: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    if (counts[sev] > 0) parts.push(`${counts[sev]} ${sev}`);
  }
  return `**Severity:** ${parts.join(", ")}`;
}

function fixHintFor(f: ScanFinding): string {
  const msg = (f.message ?? "").trim();
  if (msg === "") return "—";
  // First sentence only — keeps the cell narrow. Fall back to the full message
  // if no terminal punctuation is found.
  const period = msg.indexOf(".");
  return period > 0 ? msg.slice(0, period) : msg;
}

function tableRow(f: ScanFinding): string {
  return `| ${f.severity} | \`${f.file_path}:${f.location.line}\` | \`${f.rule_id}\` | ${fixHintFor(f)} |`;
}

export function renderSummaryBody(input: RenderInput): string {
  const { newFindings, findingsCount, codeScanningUrl } = input;
  const sorted = [...newFindings].sort(compareFindings);
  const top = sorted.slice(0, 5);
  const overflow = sorted.length - top.length;
  const counts = tabulateBySeverity(sorted);

  const lines: string[] = [
    STICKY_MARKER,
    `## hookwarden: ${sorted.length} new finding(s)`,
    "",
    severityTotalsLine(counts),
    "",
    "| Severity | Location | Rule | Fix |",
    "| --- | --- | --- | --- |",
    ...top.map(tableRow),
  ];

  if (overflow > 0) {
    lines.push("");
    lines.push(
      `_…see Code Scanning for ${overflow} more finding(s) → [view all](${codeScanningUrl})._`,
    );
  }

  lines.push("");
  lines.push(
    `_Total findings in this PR: ${findingsCount}. Inline annotations available in [Code Scanning](${codeScanningUrl})._`,
  );

  return lines.join("\n");
}
