import { describe, expect, it } from "vitest";

import { renderBanner, shouldShowBanner } from "../src/banner.js";

describe("banner — rendering", () => {
  it("includes the wordmark, tagline, and next-action hint", () => {
    const out = renderBanner({ version: "1.2.3", useAnsi: false });
    expect(out).toContain("webhook security audit");
    expect(out).toContain("v1.2.3");
    expect(out).toContain("hookwarden scan .");
    expect(out).toContain("https://hookwarden.dev");
  });

  it("emits the indigo truecolor escape when useAnsi is true", () => {
    const out = renderBanner({ version: "0.0.1", useAnsi: true });
    expect(out).toContain("\x1b[38;2;99;102;241m");
    expect(out).toContain("\x1b[0m");
  });

  it("emits no escape sequences when useAnsi is false", () => {
    const out = renderBanner({ version: "0.0.1", useAnsi: false });
    expect(out).not.toContain("\x1b[");
  });

  it("renders the wordmark across exactly 3 rows", () => {
    const out = renderBanner({ version: "0.0.1", useAnsi: false });
    const lines = out.split("\n");
    const wordmarkRows = lines.filter((l) => l.includes("█"));
    expect(wordmarkRows).toHaveLength(3);
  });
});

describe("banner — gating", () => {
  it("returns false when --no-color is set", () => {
    expect(
      shouldShowBanner({
        stream: { isTTY: true },
        env: {},
        noColorFlag: true,
      }),
    ).toBe(false);
  });

  it("returns false when stdout is not a TTY", () => {
    expect(
      shouldShowBanner({
        stream: { isTTY: false },
        env: {},
        noColorFlag: false,
      }),
    ).toBe(false);
  });

  it("returns false when NO_COLOR is set", () => {
    expect(
      shouldShowBanner({
        stream: { isTTY: true },
        env: { NO_COLOR: "1" },
        noColorFlag: false,
      }),
    ).toBe(false);
  });

  it("returns false in CI", () => {
    expect(
      shouldShowBanner({
        stream: { isTTY: true },
        env: { CI: "true" },
        noColorFlag: false,
      }),
    ).toBe(false);
  });

  it("returns true when stdout is a TTY and no opt-out signals are set", () => {
    expect(
      shouldShowBanner({
        stream: { isTTY: true },
        env: {},
        noColorFlag: false,
      }),
    ).toBe(true);
  });
});
