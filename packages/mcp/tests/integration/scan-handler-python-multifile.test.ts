// Plan 23-05 Task 2 Test 3 — Python multi-file fixture exercises the
// cross-file parse path through the engine. v0.7.0 Python rule coverage
// may not yet detect the specific Flask blueprint pattern in the fixture,
// so this test documents that parse succeeds + scan_metadata populates
// correctly, regardless of whether a specific finding emits.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadBuildManifest } from "../../src/drift-check.js";
import { scanHandler } from "../../src/tools/scan-handler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "handlers",
  "python-flask-multifile",
);

describe("scan_handler — Python multi-file (Test 9)", () => {
  it("parses cross-file Flask blueprint without parse errors; scan_metadata populated", async () => {
    const appPy = await fs.readFile(path.join(FIXTURE_ROOT, "app.py"), "utf-8");
    const webhookPy = await fs.readFile(path.join(FIXTURE_ROOT, "handlers", "webhook.py"), "utf-8");

    const manifest = await loadBuildManifest();
    const result = await scanHandler(
      {
        files: {
          "app.py": appPy,
          "handlers/webhook.py": webhookPy,
        },
      },
      manifest,
    );

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      verdict_summary: { parse_error: number };
      findings: Array<{ provider: string; verdict: string }>;
      scan_metadata: { engine_version: string };
    };
    expect(sc.verdict_summary.parse_error).toBe(0);
    expect(sc.scan_metadata.engine_version).toBe(manifest.engine.version);
  });

  it("negative: syntactically broken Python parses without crashing the tool boundary", async () => {
    // The engine's Python parser (tree-sitter-python via WASM) is permissive
    // and produces an ERROR-tree node rather than emitting an
    // engine/parse-error finding. The acceptance gate here is that the
    // handler doesn't throw past the tool boundary — bad input is data,
    // not a transport-level failure (D-23-06).
    const manifest = await loadBuildManifest();
    const result = await scanHandler(
      { code: "def broken(:\n    pass", language: "python" },
      manifest,
    );

    expect(result.isError).toBeFalsy();
    // structuredContent must still have verdict_summary populated.
    const sc = result.structuredContent as { verdict_summary: { parse_error: number } };
    expect(sc.verdict_summary).toBeDefined();
    expect(typeof sc.verdict_summary.parse_error).toBe("number");
  });
});
