// D-42: severity drives color, state drives badge color.
// D-43: gate via shouldUseAnsi from walker/tty.ts; OSC-8 hyperlinks degrade to plain text otherwise.
// D-CONTEXT: picocolors picked over chalk/kleur for minimal-dep ethos (zero deps, ESM default export).

import type { Severity, Verdict } from "@hookwarden/engine";
import pc from "picocolors";

export interface ColorOptions {
  readonly useAnsi: boolean;
}

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

export function severityHeader(s: Severity, opts: ColorOptions): string {
  const label = s.toUpperCase();
  const colored = severityColor(s, label, opts);
  const rule = "─".repeat(Math.max(8, label.length));
  return `${colored}\n${opts.useAnsi ? pc.dim(rule) : rule}`;
}

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

// D-43 OSC-8 hyperlink: `ESC ] 8 ; ; URL ESC \ DISPLAY ESC ] 8 ; ; ESC \`.
// Returns display text unchanged when useAnsi is false (CI / NO_COLOR / pipe-to-file).
const OSC = "]8;;";
const ST = "\\";

export function ansiLink(url: string, display: string, opts: ColorOptions): string {
  if (!opts.useAnsi) return display;
  return `${OSC}${url}${ST}${display}${OSC}${ST}`;
}

export function dim(text: string, opts: ColorOptions): string {
  return opts.useAnsi ? pc.dim(text) : text;
}
