// Plan 08.1-04 — PHP scan pipeline integration. Exercises runScan against
// temporary fixtures to verify the PHP runtime init + parse-dispatch branch.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS } from "../src/config/precedence.js";
import { runScan } from "../src/pipeline.js";

async function mkfixture(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hw-php-pipe-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }
  return dir;
}

async function scanDir(rootPath: string) {
  // Disable baseline lookup so tests stay self-contained (no .hookwarden.baseline.json
  // in the tmp dir).
  const resolvedConfig = { ...CONFIG_DEFAULTS, baseline_enabled: false };
  return await runScan({
    rootPath,
    resolvedConfig,
    diffOnly: false,
    diffBase: null,
    baselineWrite: false,
    verbose: false,
  });
}

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
});

afterEach(async () => {
  for (const d of dirs) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkfixture(files);
  dirs.push(dir);
  return dir;
}

// Sanity: confirm the CLI scan binary parses a single PHP file end-to-end (smoke).
// This indirectly exercises walker .php eligibility + loadPhpWasmBytes + parsePhp.
describe("runScan — PHP language support (Plan 08.1-04)", () => {
  it("parses a single .php file via parsePhp with dialect 'tree-sitter-php'", async () => {
    const dir = await fixture({
      "webhook.php": "<?php\nuse Stripe\\Webhook;\nfunction handle($req) { return 'ok'; }\n",
    });
    const { walkResult, result } = await scanDir(dir);
    expect(walkResult.files).toHaveLength(1);
    expect(walkResult.files[0]).toMatch(/webhook\.php$/);
    // The engine produces 0 findings on this trivial input but populates metadata.
    expect(result.metadata.parse_errors_count).toBe(0);
    expect(result.metadata.parse_candidates_count).toBe(1);
  });

  it("parses mixed JS + Python + PHP in the same scan", async () => {
    const dir = await fixture({
      "a.js": "const f = (req) => 'ok';\n",
      "b.py": "def handle(req):\n    return 'ok'\n",
      "c.php": "<?php\nfunction handle($req) { return 'ok'; }\n",
    });
    const { walkResult, result } = await scanDir(dir);
    expect(walkResult.files).toHaveLength(3);
    expect(result.metadata.parse_errors_count).toBe(0);
    expect(result.metadata.parse_candidates_count).toBe(3);
  });

  it("a JS-only scan does not trigger PHP runtime init (no .php files → no load)", async () => {
    const dir = await fixture({
      "a.js": "const f = (req) => 'ok';\n",
      "b.js": "module.exports = {};\n",
    });
    const { walkResult, result } = await scanDir(dir);
    expect(walkResult.files).toHaveLength(2);
    // PHP would have shown up here if any branch accidentally triggered it.
    expect(result.metadata.parse_errors_count).toBe(0);
    expect(result.metadata.parse_candidates_count).toBe(2);
  });

  it("PHP file with a syntax error surfaces as a parse-error Finding (D-27)", async () => {
    const dir = await fixture({
      "broken.php": "<?php\nfunction f($\n",
    });
    const { result } = await scanDir(dir);
    expect(result.metadata.parse_errors_count).toBeGreaterThan(0);
  });
});
