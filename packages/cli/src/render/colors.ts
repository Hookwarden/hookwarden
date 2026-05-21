// D-42: severity drives color, state drives badge color.
// D-43: gate via shouldUseAnsi from walker/tty.ts; OSC-8 hyperlinks degrade to plain text otherwise.
// Brand-aligned palette per ../docs/brand-palette.md: bg #0B0F14 / text #E5E7EB /
// accent #6366F1 / surface #1E293B / danger #F43F5E. Used sparingly — every
// color carries semantic weight (severity, state, action).

import type { Severity, Verdict } from "@hookwarden/engine";
import pc from "picocolors";

export interface ColorOptions {
  readonly useAnsi: boolean;
}

/**
 * Glyph + label rendered as the first column of a finding header.
 * Replaces the prior full-width SEVERITY banner — the glyph color
 * carries the severity signal, the label disambiguates.
 */
export function severityHeaderInline(s: Severity, opts: ColorOptions): string {
  // 9-char column so the file:line column aligns across mixed severities.
  // "× critical" / "▲ medium  " / "· info    "
  const glyph = severityGlyph(s);
  const label = s.padEnd(8);
  const text = `${glyph} ${label}`;
  if (!opts.useAnsi) return text;
  switch (s) {
    case "critical":
      return pc.bold(pc.red(text));
    case "high":
      return pc.red(text);
    case "medium":
      return pc.yellow(text);
    case "low":
      return pc.dim(text);
    case "info":
      return pc.gray(text);
  }
}

function severityGlyph(s: Severity): string {
  switch (s) {
    case "critical":
      return "×";
    case "high":
      return "!";
    case "medium":
      return "▲";
    case "low":
      return "·";
    case "info":
      return "·";
  }
}

/**
 * Bare colored severity text (no glyph) — used by the summary footer's
 * "1 critical · 0 high · ..." line where the glyph would add noise.
 */
export function severityColor(s: Severity, text: string, opts: ColorOptions): string {
  if (!opts.useAnsi) return text;
  switch (s) {
    case "critical":
      return pc.bold(pc.red(text));
    case "high":
      return pc.red(text);
    case "medium":
      return pc.yellow(text);
    case "low":
      return pc.dim(text);
    case "info":
      return pc.gray(text);
  }
}

/**
 * Three-state verdict tag, bracket-wrapped — used by the inventory
 * renderer where brackets visually delimit a tabular column. Findings
 * renderer uses {@link stateText} instead (its column spacing already
 * disambiguates).
 */
export function stateBadge(state: Verdict, opts: ColorOptions): string {
  const text = `[${state}]`;
  if (!opts.useAnsi) return text;
  switch (state) {
    case "verified":
      return pc.green(text);
    case "not-verified":
      return pc.red(text);
    case "manual-review":
      return pc.yellow(text);
  }
}

/**
 * Three-state verdict text without brackets — used by the compact
 * findings renderer where the bracket wrapping is redundant with the
 * column gap.
 */
export function stateText(state: Verdict, opts: ColorOptions): string {
  if (!opts.useAnsi) return state;
  switch (state) {
    case "verified":
      return pc.green(state);
    case "not-verified":
      return pc.red(state);
    case "manual-review":
      return pc.yellow(state);
  }
}

/**
 * `fix ›` / `docs ›` prefix for action items inside a finding body.
 * Accent-tinted (locked palette `#6366F1`) so the eye lands on the
 * actionable line, not the explanatory paragraph above it.
 */
export function actionPrefix(label: "fix" | "docs", opts: ColorOptions): string {
  const text = `${label} ›`;
  return opts.useAnsi ? pc.cyan(text) : text;
}

// D-43 OSC-8 hyperlink: `ESC ] 8 ; ; URL ESC \ DISPLAY ESC ] 8 ; ; ESC \`.
// Returns display text unchanged when useAnsi is false (CI / NO_COLOR / pipe-to-file).
// `` is the literal ESC byte (0x1b); kept as an explicit escape so the
// source-file bytes survive cross-tool roundtrips (`git diff`, IDE re-saves,
// LLM-driven rewrites) that strip raw control characters.
const OSC = "]8;;";
const ST = "\\";

export function ansiLink(url: string, display: string, opts: ColorOptions): string {
  if (!opts.useAnsi) return display;
  return `${OSC}${url}${ST}${display}${OSC}${ST}`;
}

export function dim(text: string, opts: ColorOptions): string {
  return opts.useAnsi ? pc.dim(text) : text;
}

/**
 * @deprecated kept for back-compat with existing callers (summary.ts).
 * The new findings renderer uses {@link severityHeaderInline} instead.
 * Renders the prior full-width banner shape for callers that haven't
 * migrated yet.
 */
export function severityHeader(s: Severity, opts: ColorOptions): string {
  const label = s.toUpperCase();
  const colored = severityColor(s, label, opts);
  const rule = "─".repeat(Math.max(8, label.length));
  return `${colored}\n${opts.useAnsi ? pc.dim(rule) : rule}`;
}
