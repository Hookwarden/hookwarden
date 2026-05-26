// D-42: severity drives color, state drives badge color.
// D-43: gate via shouldUseAnsi from walker/tty.ts; OSC-8 hyperlinks degrade to plain text otherwise.
//
// Colors are emitted as 24-bit truecolor SGR (`\x1b[38;2;R;G;Bm … \x1b[0m`),
// matching logo.ts, so the brand palette renders exactly rather than being
// approximated by the 16-color ANSI table. Every color still carries semantic
// weight (severity, state, action) and the whole layer is gated by useAnsi, so
// piping / NO_COLOR / CI gets clean plain text.
//
// Brand + semantic palette (../docs/brand-palette.md):
//   accent  #6366F1   success #10B981   danger #F43F5E
//   warning #F59E0B   info    #3B82F6   subtle #64748B

import type { Severity, Verdict } from "@hookwarden/engine";

// RGB triplets (no `#`), ready to splice into an SGR truecolor escape.
const RGB = {
  critical: "244;63;94", // #F43F5E
  high: "249;115;22", // #F97316 — distinct orange so high ≠ critical at a glance
  medium: "245;158;11", // #F59E0B
  low: "148;163;184", // #94A3B8 — slate, muted but legible (was near-invisible dim)
  info: "59;130;246", // #3B82F6
  verified: "16;185;129", // #10B981
  notVerified: "244;63;94", // #F43F5E
  manualReview: "245;158;11", // #F59E0B
  accent: "99;102;241", // #6366F1
  subtle: "100;116;139", // #64748B
} as const;

const ESC = "\x1b";
const RESET = `${ESC}[0m`;

export interface ColorOptions {
  readonly useAnsi: boolean;
}

/** Wrap text in a 24-bit truecolor foreground (optionally bold). No-op when ANSI is off. */
function paint(rgb: string, text: string, opts: ColorOptions, bold = false): string {
  if (!opts.useAnsi) return text;
  const weight = bold ? `${ESC}[1m` : "";
  return `${weight}${ESC}[38;2;${rgb}m${text}${RESET}`;
}

function severityRgb(s: Severity): string {
  switch (s) {
    case "critical":
      return RGB.critical;
    case "high":
      return RGB.high;
    case "medium":
      return RGB.medium;
    case "low":
      return RGB.low;
    case "info":
      return RGB.info;
  }
}

function verdictRgb(v: Verdict): string {
  switch (v) {
    case "verified":
      return RGB.verified;
    case "not-verified":
      return RGB.notVerified;
    case "manual-review":
      return RGB.manualReview;
  }
}

/**
 * Glyph + label rendered as the first column of a finding header.
 * The glyph color carries the severity signal, the label disambiguates.
 */
export function severityHeaderInline(s: Severity, opts: ColorOptions): string {
  // 9-char column so the file:line column aligns across mixed severities.
  // "× critical" / "▲ medium  " / "· info    "
  const text = `${severityGlyph(s)} ${s.padEnd(8)}`;
  return paint(severityRgb(s), text, opts, s === "critical");
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
  return paint(severityRgb(s), text, opts, s === "critical");
}

/**
 * Three-state verdict tag, bracket-wrapped — used by the inventory
 * renderer where brackets visually delimit a tabular column. Findings
 * renderer uses {@link stateText} instead (its column spacing already
 * disambiguates).
 */
export function stateBadge(state: Verdict, opts: ColorOptions): string {
  return paint(verdictRgb(state), `[${state}]`, opts, state === "verified");
}

/**
 * Three-state verdict text without brackets — used by the compact
 * findings renderer where the bracket wrapping is redundant with the
 * column gap.
 */
export function stateText(state: Verdict, opts: ColorOptions): string {
  return paint(verdictRgb(state), state, opts, state === "verified");
}

/**
 * `fix ›` / `docs ›` prefix for action items inside a finding body.
 * Accent-tinted (locked palette `#6366F1`) so the eye lands on the
 * actionable line, not the explanatory paragraph above it.
 */
export function actionPrefix(label: "fix" | "docs", opts: ColorOptions): string {
  return paint(RGB.accent, `${label} ›`, opts, true);
}

// D-43 OSC-8 hyperlink: `ESC ] 8 ; ; URL ESC \ DISPLAY ESC ] 8 ; ; ESC \`.
// Returns display text unchanged when useAnsi is false (CI / NO_COLOR / pipe-to-file).
// `` is the literal ESC byte (0x1b); kept as an explicit escape so the
// source-file bytes survive cross-tool roundtrips (`git diff`, IDE re-saves,
// LLM-driven rewrites) that strip raw control characters.
// Built from the ESC escape (not a raw 0x1b byte) so the source survives
// cross-tool roundtrips that strip control characters. OSC = `ESC ] 8 ; ;`,
// ST (string terminator) = `ESC \`.
const OSC = `${ESC}]8;;`;
const ST = `${ESC}\\`;

export function ansiLink(url: string, display: string, opts: ColorOptions): string {
  if (!opts.useAnsi) return display;
  return `${OSC}${url}${ST}${display}${OSC}${ST}`;
}

/** Subtle slate for secondary text (rule ids, scan-stats footer). */
export function dim(text: string, opts: ColorOptions): string {
  return paint(RGB.subtle, text, opts);
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
  return `${colored}\n${dim(rule, opts)}`;
}
