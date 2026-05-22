// Phase 8.2 Plan 09: hookwarden fix subcommand — value-validation gate tests.
// Full e2e flow is covered by the corpus runner in Plan 10.

import { describe, expect, it, vi } from "vitest";
import { runFixCommand, type FixArgs } from "../../src/commands/fix.js";

function captureStderr(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    writes.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  });
  return { writes, restore: () => spy.mockRestore() };
}

describe("hookwarden fix — value-validation gate (D-17 + D-12)", () => {
  it("rejects invalid --mode with exit 3 + actionable stderr", async () => {
    const cap = captureStderr();
    const exit = await runFixCommand({ mode: "invalid-mode" } as FixArgs);
    cap.restore();
    expect(exit).toBe(3);
    expect(cap.writes.join("")).toMatch(/--mode must be one of safe\|all\|manual-only-explain/);
  });

  it("rejects invalid --format with exit 3", async () => {
    const cap = captureStderr();
    const exit = await runFixCommand({ format: "yaml" } as FixArgs);
    cap.restore();
    expect(exit).toBe(3);
    expect(cap.writes.join("")).toMatch(/--format must be one of text\|json/);
  });

  it("accepts valid --mode + --format combinations", async () => {
    // We can't easily run the full pipeline in a unit test (needs WASM + rules + fixtures).
    // This test confirms the value-validation gate does NOT reject valid combos.
    // It WILL still exit non-zero because there's no project at the resolved cwd, but
    // the failure mode is post-validation (config/engine error), not the gate.
    const cap = captureStderr();
    const exit = await runFixCommand({
      mode: "safe",
      format: "text",
      path: "/tmp/__non-existent-hookwarden-fix-test__",
    } as FixArgs);
    cap.restore();
    // Either 0 (no findings → exit 0) or 2/3 (engine/config error on a non-existent path).
    // The point is: NOT 3 from the value-validation gate.
    const gateRejection = cap.writes.join("").match(/--mode must be one of|--format must be one of/);
    expect(gateRejection).toBeNull();
    // Sanity: exit code is finite.
    expect(typeof exit).toBe("number");
  });

  it("warns when --write is combined with --format json (D-17 forces dry-run)", async () => {
    const cap = captureStderr();
    await runFixCommand({
      write: true,
      format: "json",
      path: "/tmp/__non-existent-hookwarden-fix-test__",
    } as FixArgs);
    cap.restore();
    expect(cap.writes.join("")).toMatch(/--format json forces dry-run/);
  });
});
