// Phase 8.2 D-16: `hookwarden scan --fix` is rejected at parse time.

import { describe, expect, it, vi } from "vitest";
import { runScanCommand, type ScanArgs } from "../../src/commands/scan.js";

describe("scan rejects --fix (D-16)", () => {
  it("exits 3 with actionable stderr when --fix is present", async () => {
    const stderrWrites: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrWrites.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
    const args = { path: ".", fix: true } as unknown as ScanArgs;
    const exitCode = await runScanCommand(args);
    spy.mockRestore();
    expect(exitCode).toBe(3);
    expect(stderrWrites.join("")).toContain("--fix is not a scan flag");
    expect(stderrWrites.join("")).toContain("hookwarden fix [<path>]");
  });
});
