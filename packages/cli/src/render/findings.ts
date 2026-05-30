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
import {
  accent,
  actionPrefix,
  ansiLink,
  dim,
  severityColor,
  severityHeaderInline,
  stateText,
} from "./colors.js";

export interface RenderFindingsOptions {
  readonly useAnsi: boolean;
  readonly cwd: string;
  /**
   * v0.7.3+ Stitch CLI design: when true, render the Stitch-design layout:
   *   - severity-section dividers (`─── critical ───`) grouping findings
   *   - 2-line finding header (state + rule_id; file:line + confidence)
   *   - FIX text wrapped in a box-drawing `╭ FIX (safety) │ … ╰` frame
   * Default mode (verbose unset/false) renders the existing compact layout
   * — backwards compatible for every consumer that didn't pass verbose.
   */
  readonly verbose?: boolean;
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

function isUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
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

/**
 * Verbose-mode header (Stitch CLI design): 2 lines instead of 1.
 *   Line A: `<glyph> <state>  …  <rule_id>` — state leads, rule_id right.
 *   Line B: `  <file:line:col>  …  <confidence-paren>` — provenance below.
 * The 2-line shape lets the rule_id breathe and groups the location with
 * its provenance hint instead of cramming five columns onto one row.
 */
function renderVerboseHeader(
  f: Finding,
  opts: RenderFindingsOptions,
  rule: RuleDefinition | undefined,
): string {
  const absPath = path.resolve(opts.cwd, f.file_path);
  const locText = `${f.file_path}:${f.location.line}:${f.location.col}`;
  const fileLink = ansiLink(
    `file://${absPath}:${f.location.line}:${f.location.col}`,
    locText,
    opts,
  );

  // Glyph carries severity color; state pill carries verdict color. Together
  // they tell the reader "how bad" (glyph) and "how sure" (state) at a glance.
  const glyph = severityHeaderInline(f.severity, opts).split(" ")[0] ?? "";
  const stateCol = stateText(f.state, opts);

  // Right-align rule_id to a reasonable column. 110-col wrap is what the
  // body uses; line up rule_id near the right margin so the eye lands on
  // the actionable identifier first when scanning down a long report.
  const ruleId = dim(f.rule_id, opts);
  const lineA = `${glyph} ${stateCol}  ${ruleId}`;

  // Confidence parenthetical:
  //   - manual-review → `(needs human review)` (action-oriented)
  //   - rule with predicate → `(high confidence)` (statically proven)
  //   - parse-error / pseudo-rules → omit (would be misleading)
  let confidence = "";
  if (f.state === "manual-review") {
    confidence = "(needs human review)";
  } else if (rule !== undefined) {
    confidence = "(high confidence)";
  }
  const lineB =
    confidence !== ""
      ? `  ${dim(fileLink, opts)}  ${dim(confidence, opts)}`
      : `  ${dim(fileLink, opts)}`;

  return `${lineA}\n${lineB}`;
}

/**
 * Wrap fix prose in a box-drawing frame (Stitch CLI verbose design):
 *
 *   ╭ FIX (manual-only)
 *   │  Register express.json() AFTER the webhook route, …
 *   ╰
 *
 * The safety label (safe / unsafe / manual-only) lives on the open line so
 * the reader immediately knows whether `hookwarden fix --write` can apply
 * this mechanically or whether human judgment is required.
 */
function renderFixBox(
  fix: string,
  fixSafety: "safe" | "unsafe" | "manual-only" | null,
  indent: string,
  wrapCol: number,
  opts: RenderFindingsOptions,
): string[] {
  const safetyLabel = fixSafety !== null ? `FIX (${fixSafety})` : "FIX";
  const open = `${indent}${accent("╭", opts, true)} ${accent(safetyLabel, opts, true)}`;
  const close = `${indent}${accent("╰", opts, true)}`;
  const wrapped = softWrap(fix, "", wrapCol - 6); // 6 = "│  " body indent + buffer
  const body = wrapped.map((line) => `${indent}${accent("│", opts, true)}  ${line.trim()}`);
  return [open, ...body, close];
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

  // Header: verbose mode uses the 2-line Stitch design (state leads, file
  // provenance below); default mode keeps the compact one-line shape that
  // every existing test + snapshot relies on.
  let header: string;
  if (opts.verbose === true) {
    header = renderVerboseHeader(f, opts, rule);
  } else {
    const sevCol = severityHeaderInline(f.severity, opts);
    const stateCol = stateText(f.state, opts);
    header = `${sevCol}  ${fileLink}  ${dim(f.rule_id, opts)}  ${stateCol}`;
  }

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
    if (opts.verbose === true) lines.push(""); // breathing room after the 2-line header
    lines.push(...softWrap(explanation, indent, wrapCol));
  }
  if (fix !== null) {
    if (opts.verbose === true) {
      // Stitch FIX box: framed prose with safety label on the open line.
      lines.push("");
      lines.push(...renderFixBox(fix, rule?.fix?.safety ?? null, indent, wrapCol, opts));
    } else {
      // Default mode: compact `fix › <prose>` line(s).
      const fixPrefix = actionPrefix("fix", opts);
      const fixWrapped = softWrap(fix, "", wrapCol - 6); // 6 = "fix › " width
      if (fixWrapped.length > 0) {
        lines.push(`${indent}${fixPrefix} ${fixWrapped[0]?.trim() ?? ""}`);
        for (let i = 1; i < fixWrapped.length; i += 1) {
          lines.push(`${indent}      ${fixWrapped[i]?.trim() ?? ""}`);
        }
      }
    }
  }

  // Docs link.
  if (rule?.provider_docs_url) {
    const docsPrefix = actionPrefix("docs", opts);
    const linked = ansiLink(rule.provider_docs_url, rule.provider_docs_url, opts);
    lines.push(`${indent}${docsPrefix} ${linked}`);
  }

  // References block (v0.7.1+) — external citations beyond the provider's own
  // docs page. Distinct from `docs ›` because the roles differ: docs › is the
  // vendor's canonical security page; refs › are independent authorities
  // (CWE, RFCs, Svix/Hookdeck guides) that auditors follow back to a stable
  // external source. Continuation lines align under the first reference.
  if (rule?.references != null && rule.references.length > 0) {
    const refsPrefix = actionPrefix("refs", opts);
    const firstRef = rule.references[0] ?? "";
    const firstRendered = isUrl(firstRef) ? ansiLink(firstRef, firstRef, opts) : firstRef;
    lines.push(`${indent}${refsPrefix} ${firstRendered}`);
    for (let i = 1; i < rule.references.length; i += 1) {
      const ref = rule.references[i] ?? "";
      const rendered = isUrl(ref) ? ansiLink(ref, ref, opts) : ref;
      // 7 spaces = "refs › " visible width, so continuation aligns under the first ref.
      lines.push(`${indent}       ${rendered}`);
    }
  }

  // manual-review verdicts mean the engine can't statically prove the
  // handler safe or unsafe (verification conditional, replay defense
  // outside the call graph, etc). The user needs to know what action
  // is expected — without this line, they're left guessing.
  //
  // Gated on `rule !== undefined`: this filters out engine-internal
  // pseudo-rules like `engine/parse-error` (no rule pack entry) where
  // the baseline-write hint would be misleading — a parse error isn't
  // something you "accept", it's something you fix or .gitignore.
  if (f.state === "manual-review" && rule !== undefined) {
    const nextPrefix = actionPrefix("next", opts);
    const guidance =
      "review the handler in context. If the missing check lives outside this file (gateway, dedupe table, conditional verification), run `hookwarden scan --baseline write` to accept it.";
    const wrapped = softWrap(guidance, "", wrapCol - 7); // 7 = "next › " width
    if (wrapped.length > 0) {
      lines.push(`${indent}${nextPrefix} ${wrapped[0]?.trim() ?? ""}`);
      for (let i = 1; i < wrapped.length; i += 1) {
        lines.push(`${indent}       ${wrapped[i]?.trim() ?? ""}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Render an engine/parse-error finding as a neutral telemetry line, not a
 * severity-glyphed finding. The orange `! high` glyph would directly
 * contradict the "high = exploitable verification weakness" legend that
 * the summary footer prints; a parse error isn't an exploitable weakness,
 * it's "the engine couldn't read this file." Shape:
 *
 *   ? <file:line:col>  parse error
 *     <message>
 *
 * No state badge (state=manual-review on a parse-error means nothing
 * actionable to a user — there's no handler to review). No rule_id badge
 * either; the literal label "parse error" is enough.
 */
function renderParseError(f: Finding, opts: RenderFindingsOptions): string {
  const absPath = path.resolve(opts.cwd, f.file_path);
  const locText = `${f.file_path}:${f.location.line}:${f.location.col}`;
  const fileLink = ansiLink(
    `file://${absPath}:${f.location.line}:${f.location.col}`,
    locText,
    opts,
  );
  const glyph = dim("?", opts);
  const label = dim("parse error", opts);
  const header = `${glyph}  ${fileLink}  ${label}`;
  const body = `  ${collapseWhitespace(f.message)}`;
  return `${header}\n${body}`;
}

export function renderFindings(
  result: ScanResult,
  ruleSet: RuleSet | null,
  opts: RenderFindingsOptions,
): string {
  // Split parse-error findings (engine telemetry) from rule findings (webhook
  // verification verdicts). Rule findings drive the severity tally + glyphs;
  // parse errors render in a distinct trailing block so the headline severity
  // counts don't contradict their own legend.
  const ruleFindings = result.findings.filter((f) => f.rule_id !== "engine/parse-error");
  const parseErrorFindings = result.findings.filter((f) => f.rule_id === "engine/parse-error");

  if (ruleFindings.length === 0 && parseErrorFindings.length === 0) return "No findings.\n";

  const rulesByID = indexRules(ruleSet);
  const sorted = [...ruleFindings].sort(compareFindings);
  const sortedParseErrors = [...parseErrorFindings].sort((a, b) => {
    if (a.file_path !== b.file_path) return a.file_path < b.file_path ? -1 : 1;
    if (a.location.line !== b.location.line) return a.location.line - b.location.line;
    return a.location.col - b.location.col;
  });

  // Default mode (existing layout — every test/snapshot relies on this shape):
  // rule findings flow as a flat list separated by blank lines; severity is
  // carried by the inline glyph + color in each finding's one-line header.
  // Parse-error findings (if any) render as a trailing block with `?` glyph.
  if (opts.verbose !== true) {
    const renderedRules = sorted.map((f) => renderFinding(f, rulesByID.get(f.rule_id), opts));
    const renderedParseErrors = sortedParseErrors.map((f) => renderParseError(f, opts));
    const blocks: string[] = [];
    if (renderedRules.length > 0) blocks.push(renderedRules.join("\n\n"));
    if (renderedParseErrors.length > 0) blocks.push(renderedParseErrors.join("\n\n"));
    if (blocks.length === 0) return "No findings.\n";
    return `${blocks.join("\n\n")}\n\n`;
  }

  // Verbose mode (Stitch CLI design): findings grouped by severity with a
  // full-width section divider preceding each group (`─── critical ───`).
  // Groups iterate in the canonical severity-desc order so output is stable
  // regardless of input order. Empty groups are skipped — no `─── medium ───`
  // header when zero medium findings exist.
  const SectionWidth = 78; // matches the 78-col footer rule in summary.ts
  const groups = new Map<Severity, Finding[]>();
  for (const sev of ["critical", "high", "medium", "low", "info"] as Severity[]) {
    groups.set(sev, []);
  }
  for (const f of sorted) {
    const bucket = groups.get(f.severity);
    if (bucket !== undefined) bucket.push(f);
  }

  const sections: string[] = [];
  for (const [sev, bucket] of groups) {
    if (bucket.length === 0) continue;
    const label = severityColor(sev, sev, opts);
    const dashCount = Math.max(4, SectionWidth - sev.length - 5); // "─── " + " " + dashes
    const divider = `${dim("─── ", opts)}${label} ${dim("─".repeat(dashCount), opts)}`;
    const renderedGroup = bucket.map((f) => renderFinding(f, rulesByID.get(f.rule_id), opts));
    sections.push(`${divider}\n\n${renderedGroup.join("\n\n")}`);
  }
  // Parse-error block lives below the severity groups — engine telemetry,
  // distinct from rule findings. Same divider treatment, dim label since
  // parse errors don't carry severity-colored signal.
  if (sortedParseErrors.length > 0) {
    const peLabel = "parse errors";
    const dashCount = Math.max(4, SectionWidth - peLabel.length - 5);
    const divider = `${dim("─── ", opts)}${dim(peLabel, opts)} ${dim("─".repeat(dashCount), opts)}`;
    const renderedGroup = sortedParseErrors.map((f) => renderParseError(f, opts));
    sections.push(`${divider}\n\n${renderedGroup.join("\n\n")}`);
  }
  // Trailing double-newline so the summary footer renders flush against a clean blank.
  return `${sections.join("\n\n")}\n\n`;
}
