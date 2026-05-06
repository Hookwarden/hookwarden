import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, type ResolvedConfig } from "../src/config/precedence.js";
import { loadRulesFromDir } from "../src/load-rules.js";
import { type RunScanInput, runScan } from "../src/pipeline.js";

function scanInput(rootPath: string, overrides: Partial<ResolvedConfig> = {}): RunScanInput {
  return {
    rootPath,
    resolvedConfig: { ...CONFIG_DEFAULTS, ...overrides },
    diffOnly: false,
    diffBase: null,
    baselineWrite: false,
    verbose: false,
  };
}

let tmp: string;

async function writeFile(rel: string, content: string): Promise<void> {
  const abs = path.join(tmp, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cli-cmd-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("runScan pipeline (CLI-01 + DISCOVERY-01)", () => {
  it("returns ScanResult with metadata, even on empty dir", async () => {
    const out = await runScan(scanInput(tmp));
    expect(out.result.findings).toEqual([]);
    expect(out.result.inventory).toEqual([]);
    expect(out.result.metadata.engine_version).toBeTruthy();
    expect(out.result.metadata.rule_pack_version).toBeTruthy();
    expect(out.durationMs).toBeGreaterThan(0);
    expect(out.walkResult.parsed_files_count_estimate).toBe(0);
  });

  it("respects .gitignore — excluded files do not appear in walkResult", async () => {
    await writeFile(".gitignore", "private/\n");
    await writeFile("public.ts", "// keep");
    await writeFile("private/secret.ts", "const whsec_test_DEMO = 'whsec_x';");
    const out = await runScan(scanInput(tmp));
    const rels = out.walkResult.files.map((f) => path.relative(tmp, f));
    expect(rels).toContain("public.ts");
    expect(rels.some((p) => p.startsWith("private"))).toBe(false);
  });

  it("captures rules-load failure as engineError (does not throw)", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "no-rules-"));
    try {
      const out = await runScan(scanInput(tmp, { rules_dir: empty }));
      expect(out.engineError).not.toBeNull();
      expect(out.engineError?.message).toMatch(/rule pack/i);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe("loadRulesFromDir — bundled-rules path (Phase 4.2 DC-19, replaces W-6 filesystem-resolver)", () => {
  it("uses the build-time-bundled rule documents when no rulesDir is supplied", async () => {
    // Default path (no --rules-dir): consumes BUNDLED_RULE_DOCUMENTS from
    // @hookwarden/rules. No filesystem access, no YAML parsing at runtime.
    // This is the canonical path for both Node + npm and Bun --compile.
    const ruleSet = await loadRulesFromDir();
    expect(ruleSet.rule_pack_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(ruleSet.rules.length).toBeGreaterThan(0);
  });

  it("loads from disk when rulesDir override is supplied (dev-only --rules-dir)", async () => {
    // Override path: still works for dev workflows that point at a local YAML tree.
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const overrideDir = path.join(repoRoot, "packages", "rules", "rules");
    const ruleSet = await loadRulesFromDir({ rulesDir: overrideDir });
    expect(ruleSet.rules.length).toBeGreaterThan(0);
  });
});
