// Phase 8.1 Plan 10 — FP-01 measurement against the curated PHP corpus.
//
// Definition: a false positive is a high/critical Finding (verdict != manual-review)
// emitted on a `.negative.*.php` fixture — i.e. the fixture documents itself as the SAFE
// form of a webhook handler, and the engine should NOT raise any verdicts.
//
// Pass criterion: fp_rate <= 0.05 (5%) per .planning/PROJECT.md quality bars.
// Manual-review findings are excluded from the count per D-15.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_ADAPTERS,
  buildProjectModel,
  type Config,
  evaluate,
  initPhpRuntime,
  type ParsedFile,
  type PhpRuntime,
  parsePhp,
  type RuleSet,
} from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ALL_PREDICATES,
  BUNDLED_RULE_DOCUMENTS,
  loadRuleSet,
  PROVIDER_CATALOG,
  RULES_PACK_VERSION,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, "fixtures");
const RESULT_PATH = join(HERE, "fp-measurement-php-result.json");

const require = createRequire(import.meta.url);
function resolvePhpWasmPath(): string {
  const pkgPath = require.resolve("tree-sitter-php/package.json");
  return join(dirname(pkgPath), "tree-sitter-php.wasm");
}

function discoverNegativeFixtures(): ReadonlyArray<{
  readonly absPath: string;
  readonly relPath: string;
  readonly provider: string;
}> {
  const out: { absPath: string; relPath: string; provider: string }[] = [];
  const providers = ["stripe", "github", "shopify", "slack", "twilio", "square"];
  for (const p of providers) {
    const dir = join(FIXTURE_ROOT, p, "php");
    let entries: ReadonlyArray<string>;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry);
      if (!statSync(abs).isFile() || !entry.endsWith(".php")) continue;
      // Only `.negative.` fixtures count toward FP measurement. `.inconclusive.` fixtures
      // are excluded per D-15. `.positive.` fixtures are expected to emit; not measured here.
      if (!entry.includes(".negative.")) continue;
      out.push({ absPath: abs, relPath: relative(FIXTURE_ROOT, abs), provider: p });
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

const CONFIG: Config = {
  reachability_max_depth: 3,
  scanned_at: "2026-05-22T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
};

let phpRuntime: PhpRuntime;
let ruleSet: RuleSet;

beforeAll(async () => {
  phpRuntime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
  ruleSet = await loadRuleSet({
    rule_documents: BUNDLED_RULE_DOCUMENTS.map((d) => d.doc),
    predicates: ALL_PREDICATES,
    providers: PROVIDER_CATALOG,
    rule_pack_version: RULES_PACK_VERSION,
  });
}, 30_000);

describe("FP-01 measurement — PHP corpus (Phase 8.1 Plan 10)", () => {
  it("measures false-positive rate on .negative. fixtures and writes a deterministic JSON artefact", async () => {
    const fixtures = discoverNegativeFixtures();
    expect(fixtures.length).toBeGreaterThan(0);

    const perFixture: Array<{
      readonly relPath: string;
      readonly provider: string;
      readonly false_positive_findings: ReadonlyArray<{
        readonly rule_id: string;
        readonly severity: string;
        readonly verdict: string;
      }>;
      readonly is_false_positive: boolean;
    }> = [];

    const perRule: Map<string, number> = new Map();
    let falsePositiveCount = 0;

    for (const fx of fixtures) {
      const text = readFileSync(fx.absPath, "utf8");
      const parsedFile: ParsedFile = await parsePhp(
        { file_path: fx.relPath, source_text: text },
        phpRuntime,
      );
      const model = await buildProjectModel({
        parsedFiles: [parsedFile],
        ruleSet,
        config: CONFIG,
        bespokeAdapters: ALL_ADAPTERS,
      });
      const result = await evaluate(model, ruleSet, CONFIG);
      // FP filter: high/critical severity, verdict NOT in {verified, manual-review}.
      // (verified is the correct verdict on a safe-form fixture — not an FP.
      // manual-review is excluded per D-15.)
      const fps = result.findings.filter(
        (f) =>
          (f.severity === "high" || f.severity === "critical") &&
          f.state !== "verified" &&
          f.state !== "manual-review",
      );
      const isFp = fps.length > 0;
      if (isFp) falsePositiveCount++;
      for (const f of fps) {
        perRule.set(f.rule_id, (perRule.get(f.rule_id) ?? 0) + 1);
      }
      perFixture.push({
        relPath: fx.relPath,
        provider: fx.provider,
        false_positive_findings: fps.map((f) => ({
          rule_id: f.rule_id,
          severity: f.severity,
          verdict: f.state,
        })),
        is_false_positive: isFp,
      });
    }

    const fpRate = falsePositiveCount / fixtures.length;

    // Write deterministic JSON artefact — sorted keys, sorted per-rule breakdown.
    const sortedPerRule = Array.from(perRule.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([rule_id, count]) => ({ rule_id, false_positive_count: count }));

    const artefact = {
      measured_at: CONFIG.scanned_at,
      total_negative_fixtures: fixtures.length,
      false_positives: falsePositiveCount,
      false_positive_rate: Number(fpRate.toFixed(4)),
      pass_threshold: 0.05,
      pass: fpRate <= 0.05,
      per_rule_breakdown: sortedPerRule,
      per_fixture: perFixture.sort((a, b) => a.relPath.localeCompare(b.relPath)),
      severity_filter: ["high", "critical"],
      excluded_verdicts: ["verified", "manual-review"],
    };
    writeFileSync(RESULT_PATH, `${JSON.stringify(artefact, null, 2)}\n`, "utf8");

    // Gate assertion — fp_rate must be at or under 5%.
    if (fpRate > 0.05) {
      const breakdownLines = sortedPerRule
        .map((r) => `  - ${r.rule_id}: ${r.false_positive_count}`)
        .join("\n");
      throw new Error(
        `FP-01 GATE FAILED: ${falsePositiveCount} / ${fixtures.length} = ${(fpRate * 100).toFixed(2)}% (>5%).\n` +
          `Per-rule breakdown:\n${breakdownLines}\n` +
          `See ${RESULT_PATH} for the full per-fixture listing.`,
      );
    }
    expect(fpRate).toBeLessThanOrEqual(0.05);
  });
});
