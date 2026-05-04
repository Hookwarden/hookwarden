// Hero banner for the no-arg `hookwarden` invocation. Skipped when stdout is
// not a TTY, when NO_COLOR / --no-color / CI is set, or when the user is
// invoking a subcommand. Pre-commit, CI logs, and piped stdout all stay
// silent — D-43 reuses the same gate as the existing color/OSC-8 paths.

import pc from "picocolors";

import { shouldUseAnsi } from "./walker/tty.js";

const ACCENT_RGB = "99;102;241"; // #6366F1 — locked brand indigo.

// Uppercase wordmark for "HOOKWARDEN". Each letter is a 3-row × N-col glyph
// (N is 4 or 5). Letters are joined with a single-space gap per row.
// Uppercase reads cleaner than lowercase in 3-row block ASCII because every
// glyph fills the full vertical band — no empty top-row cells make h/d/etc.
// look visually punched-in. Rendered in indigo (#6366F1) on TTY.
const GLYPHS: Record<string, ReadonlyArray<string>> = {
  H: ["█  █", "████", "█  █"],
  O: ["▄▀▀▄", "█  █", "▀▄▄▀"],
  K: ["█ ▄▀", "█▀▄ ", "█ ▀▄"],
  W: ["█   █", "█ █ █", "▀▄▀▄▀"],
  A: ["▄▀▀▄", "█▀▀█", "█  █"],
  R: ["█▀▀▄", "██▀ ", "█ ▀▄"],
  D: ["█▀▀▄", "█  █", "█▄▄▀"],
  E: ["████", "█▀▀ ", "████"],
  N: ["█  █", "██ █", "█ ██"],
};

const WORD = "HOOKWARDEN";

const WORDMARK_LINES: ReadonlyArray<string> = (() => {
  const rows: string[] = ["", "", ""];
  for (let i = 0; i < WORD.length; i++) {
    const ch = WORD[i] as keyof typeof GLYPHS;
    const glyph = GLYPHS[ch];
    if (glyph === undefined) continue;
    for (let r = 0; r < 3; r++) {
      const cell = glyph[r] ?? "";
      rows[r] = (rows[r] ?? "") + cell + (i === WORD.length - 1 ? "" : "  ");
    }
  }
  return rows;
})();

export interface BannerOptions {
  readonly version: string;
  readonly useAnsi: boolean;
}

export function renderBanner(opts: BannerOptions): string {
  const accent = (text: string): string =>
    opts.useAnsi ? `\x1b[38;2;${ACCENT_RGB}m${text}\x1b[0m` : text;
  const dim = (text: string): string => (opts.useAnsi ? pc.dim(text) : text);

  const wordmark = WORDMARK_LINES.map((line) => `  ${accent(line)}`).join("\n");
  const tagline = `  webhook security audit  ${dim("·")}  v${opts.version}`;
  const promise = dim("  find every signature-verification bug  ·  <5% false positives");
  const tryLine = `  Try:  ${accent("hookwarden scan .")}`;
  const docs = `  Docs: ${dim("https://hookwarden.dev")}`;

  return ["", wordmark, "", tagline, promise, "", tryLine, docs, ""].join("\n");
}

export interface BannerGateInput {
  readonly stream: { isTTY?: boolean } | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly noColorFlag: boolean;
}

export function shouldShowBanner(input: BannerGateInput): boolean {
  if (input.noColorFlag) return false;
  return shouldUseAnsi(input.stream, input.env);
}
