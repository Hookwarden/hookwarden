import { describe, expect, it } from "vitest";

import { LOGO_DIMENSIONS, renderLogo } from "../src/logo.js";

describe("logo — rendering", () => {
  it("renders the _| wordmark when terminal is wide enough to fit it", () => {
    const out = renderLogo({ columns: 120, useAnsi: false });
    expect(out).toContain("@");
    expect(out).toContain("%");
    expect(out).toContain("_|");
  });

  it("falls back to a plain-text caption when terminal is too narrow for the wordmark", () => {
    const out = renderLogo({ columns: 80, useAnsi: false });
    expect(out).toContain("@");
    expect(out).not.toContain("_|");
    expect(out).toContain("hookwarden");
  });

  it("renders the mascot at full source size when terminal is wide enough", () => {
    const out = renderLogo({ columns: 200, useAnsi: false });
    const lines = out.split("\n");
    const mascotRows = lines.filter((l) => l.includes("@") || l.includes("%"));
    expect(mascotRows.length).toBe(LOGO_DIMENSIONS.mascot.rows);
  });

  it("scales the mascot down when the terminal is narrower than the source art", () => {
    const narrow = renderLogo({ columns: 60, useAnsi: false });
    const wide = renderLogo({ columns: 120, useAnsi: false });
    const narrowMaxLineWidth = Math.max(...narrow.split("\n").map((l) => stripAnsi(l).length));
    const wideMaxLineWidth = Math.max(...wide.split("\n").map((l) => stripAnsi(l).length));
    expect(narrowMaxLineWidth).toBeLessThan(wideMaxLineWidth);
    expect(narrowMaxLineWidth).toBeLessThanOrEqual(60);
  });

  it("preserves a 4-col left+right margin (no line touches column 0)", () => {
    const out = renderLogo({ columns: 80, useAnsi: false });
    const lines = out.split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) {
      expect(line.startsWith("  ")).toBe(true);
    }
  });

  it("emits the indigo truecolor escape when useAnsi is true", () => {
    const out = renderLogo({ columns: 80, useAnsi: true });
    expect(out).toContain("\x1b[38;2;99;102;241m");
    expect(out).toContain("\x1b[0m");
  });

  it("emits no escape sequences when useAnsi is false", () => {
    const out = renderLogo({ columns: 80, useAnsi: false });
    expect(out).not.toContain("\x1b[");
  });

  it("does not crash on tiny terminals (clamps to a 20-col floor)", () => {
    const out = renderLogo({ columns: 10, useAnsi: false });
    expect(out.length).toBeGreaterThan(0);
    const maxLineWidth = Math.max(...out.split("\n").map((l) => l.length));
    // Floor is 20 cols of art + 2-col left margin.
    expect(maxLineWidth).toBeLessThanOrEqual(22);
  });
});

function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences is the point.
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
