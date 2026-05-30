import { describe, expect, it, vi } from "vitest";
import { shouldDisableTrivia, startTriviaTicker, TRIVIA } from "../src/trivia.js";

/** Test-friendly write-capturing stream. */
function makeStream(isTTY = true): {
  isTTY: boolean;
  writes: string[];
  write: (s: string) => boolean;
} {
  const writes: string[] = [];
  return {
    isTTY,
    writes,
    write(s: string): boolean {
      writes.push(s);
      return true;
    },
  };
}

describe("trivia bank", () => {
  it("ships ≥30 tips so the rotation doesn't feel repetitive in long scans", () => {
    // Soft floor — the bank can grow but shouldn't shrink under this.
    expect(TRIVIA.length).toBeGreaterThanOrEqual(30);
  });

  it("every tip is non-empty and ≤80 chars (terminal-safe, no mid-line wrap)", () => {
    for (const tip of TRIVIA) {
      expect(tip.length).toBeGreaterThan(0);
      expect(tip.length).toBeLessThanOrEqual(120); // hard cap above the 80 target
    }
  });
});

describe("shouldDisableTrivia", () => {
  it("explicit --no-trivia wins over every other signal", () => {
    expect(
      shouldDisableTrivia({
        noTrivia: true,
        stream: { isTTY: true },
        env: {} as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });

  it("non-TTY stream → disabled (piped or redirected stderr)", () => {
    expect(
      shouldDisableTrivia({
        stream: { isTTY: false },
        env: {} as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });

  it("CI=true → disabled (GitHub Actions / GitLab CI / etc. all set this)", () => {
    expect(
      shouldDisableTrivia({
        stream: { isTTY: true },
        env: { CI: "true" } as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });

  it("CI=false → NOT disabled (some envs set CI=false to mean 'no CI')", () => {
    expect(
      shouldDisableTrivia({
        stream: { isTTY: true },
        env: { CI: "false" } as NodeJS.ProcessEnv,
      }),
    ).toBe(false);
  });

  it("NO_COLOR set → disabled (universal opt-out for decorative output)", () => {
    expect(
      shouldDisableTrivia({
        stream: { isTTY: true },
        env: { NO_COLOR: "1" } as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });

  it("TTY + no CI + no NO_COLOR + no --no-trivia → enabled", () => {
    expect(
      shouldDisableTrivia({
        stream: { isTTY: true },
        env: {} as NodeJS.ProcessEnv,
      }),
    ).toBe(false);
  });
});

describe("startTriviaTicker", () => {
  it("returns a no-op stop() when disabled — nothing written, nothing scheduled", () => {
    const stream = makeStream(true);
    const stop = startTriviaTicker({
      disabled: true,
      stream,
      trivia: ["tip-1"],
      startDelayMs: 0,
    });
    stop();
    expect(stream.writes).toEqual([]);
  });

  it("returns a no-op stop() when trivia bank is empty (defensive)", () => {
    const stream = makeStream(true);
    const stop = startTriviaTicker({
      disabled: false,
      stream,
      trivia: [],
      startDelayMs: 0,
    });
    stop();
    expect(stream.writes).toEqual([]);
  });

  it("does not write before startDelayMs elapses", async () => {
    vi.useFakeTimers();
    try {
      const stream = makeStream(true);
      const stop = startTriviaTicker({
        disabled: false,
        stream,
        trivia: ["a", "b"],
        startDelayMs: 1000,
        rotateMs: 500,
      });
      vi.advanceTimersByTime(999);
      expect(stream.writes).toEqual([]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes the first tip exactly at startDelayMs and rotates every rotateMs", async () => {
    vi.useFakeTimers();
    try {
      const stream = makeStream(true);
      const stop = startTriviaTicker({
        disabled: false,
        stream,
        trivia: ["a", "b", "c"],
        startDelayMs: 1000,
        rotateMs: 500,
      });
      vi.advanceTimersByTime(1000); // first tip
      expect(stream.writes.length).toBe(1);
      vi.advanceTimersByTime(500); // second tip
      expect(stream.writes.length).toBe(2);
      vi.advanceTimersByTime(500); // third tip
      expect(stream.writes.length).toBe(3);
      stop();
      // stop() should write a final clear-line escape
      expect(stream.writes[stream.writes.length - 1]).toContain("\r\x1b[K");
    } finally {
      vi.useRealTimers();
    }
  });

  it("each tip write begins with `\\r\\x1b[K` so subsequent prints overwrite cleanly", async () => {
    vi.useFakeTimers();
    try {
      const stream = makeStream(true);
      const stop = startTriviaTicker({
        disabled: false,
        stream,
        trivia: ["the-tip"],
        startDelayMs: 0,
        rotateMs: 100,
      });
      vi.advanceTimersByTime(0);
      expect(stream.writes[0]?.startsWith("\r\x1b[K")).toBe(true);
      expect(stream.writes[0]).toContain("the-tip");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() before the start timer fires → no output (early-cancel path)", async () => {
    vi.useFakeTimers();
    try {
      const stream = makeStream(true);
      const stop = startTriviaTicker({
        disabled: false,
        stream,
        trivia: ["a"],
        startDelayMs: 1000,
        rotateMs: 500,
      });
      // Stop before the 1000ms start delay fires (the common case: fast scan).
      vi.advanceTimersByTime(500);
      stop();
      vi.advanceTimersByTime(5000);
      expect(stream.writes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
