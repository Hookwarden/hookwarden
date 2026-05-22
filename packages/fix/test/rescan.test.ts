// Phase 8.2 Plan 05 Task 2: rescan thin-wrapper tests.
// The path-traversal defense is tested in the CLI's pipeline test surface
// (pipeline.fileList override). This test verifies the rescan wrapper
// correctly threads files through the injected runner.

import { describe, expect, it } from "vitest";
import type { ScanResult } from "@hookwarden/engine";
import { rescanFiles, type RescanRunner } from "../src/rescan.js";

const STUB_SCAN_RESULT: ScanResult = {
  findings: [],
  inventory: [],
  metadata: {
    engine_version: "0.0.0",
    engine_commit_sha: null,
    rule_pack_version: "0.0.0",
    rule_pack_content_hash: "sha256:0",
    scanned_at: "2026-05-22T00:00:00.000Z",
    parse_errors_count: 0,
    parsed_files_count: 0,
    total_files_count: 0,
    parse_candidates_count: 0,
  },
};

describe("rescanFiles", () => {
  it("threads the file list through to the runner with diffOnly:false + baselineWrite:false", async () => {
    let observed: { fileList: ReadonlyArray<string>; diffOnly: boolean; baselineWrite: boolean } | null = null;
    const runner: RescanRunner = async (input) => {
      observed = {
        fileList: input.fileList,
        diffOnly: input.diffOnly,
        baselineWrite: input.baselineWrite,
      };
      return { result: STUB_SCAN_RESULT };
    };
    await rescanFiles({
      repoRoot: "/tmp/repo",
      files: ["src/a.ts", "src/b.ts"],
      resolvedConfig: {},
      runner,
    });
    expect(observed).not.toBeNull();
    expect(observed!.fileList).toEqual(["src/a.ts", "src/b.ts"]);
    expect(observed!.diffOnly).toBe(false);
    expect(observed!.baselineWrite).toBe(false);
  });

  it("returns the runner's ScanResult unchanged", async () => {
    const runner: RescanRunner = async () => ({ result: STUB_SCAN_RESULT });
    const result = await rescanFiles({
      repoRoot: "/tmp/repo",
      files: ["src/a.ts"],
      resolvedConfig: {},
      runner,
    });
    expect(result).toBe(STUB_SCAN_RESULT);
  });

  it("propagates runner errors (e.g., path-traversal rejection from pipeline)", async () => {
    const runner: RescanRunner = async () => {
      throw new Error(
        'runScan: fileList entry "../etc/passwd" escapes repoRoot; refusing',
      );
    };
    await expect(
      rescanFiles({
        repoRoot: "/tmp/repo",
        files: ["../etc/passwd"],
        resolvedConfig: {},
        runner,
      }),
    ).rejects.toThrow(/escapes repoRoot/);
  });

  it("works with empty file list (delegates to runner; runner decides behavior)", async () => {
    let receivedEmpty = false;
    const runner: RescanRunner = async (input) => {
      receivedEmpty = input.fileList.length === 0;
      return { result: STUB_SCAN_RESULT };
    };
    await rescanFiles({ repoRoot: "/tmp/repo", files: [], resolvedConfig: {}, runner });
    expect(receivedEmpty).toBe(true);
  });
});
