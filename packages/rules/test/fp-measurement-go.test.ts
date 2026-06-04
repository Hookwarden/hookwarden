// Phase 27 (RULES-06) — FP measurement against the curated Go corpus.
//
// Definition: a false positive is a high/critical Finding (state != verified, != manual-review)
// emitted on a `.negative.*.go` fixture — the fixture documents itself as the SAFE form (SDK-verified
// or a correct hand-rolled hmac.Equal handler) and the engine should NOT raise a high/critical verdict.
//
// Pass criterion: fp_rate <= 0.05 (5%) per .planning/PROJECT.md quality bars. manual-review excluded.
//
// Anti-vacuous guard (T-27-corpus-vacuous): the corpus is NOT allowed to pass by detecting nothing —
// the SDK-verified negatives MUST render `verified` (proving handlers are detected + attributed), and
// the `.positive.` broken fixtures MUST render critical not-verified (proving the rule fires).

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_ADAPTERS,
  buildProjectModel,
  type Config,
  evaluate,
  type GoRuntime,
  initGoRuntime,
  type ParsedFile,
  parseGo,
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
const RESULT_PATH = join(HERE, "fp-measurement-go-result.json");
const PROVIDERS = ["stripe", "github", "standardwebhooks"];

const require = createRequire(import.meta.url);
function resolveGoWasmPath(): string {
  const pkgPath = require.resolve("tree-sitter-go/package.json");
  return join(dirname(pkgPath), "tree-sitter-go.wasm");
}

interface Fixture {
  readonly absPath: string;
  readonly relPath: string;
  readonly provider: string;
  readonly kind: "negative" | "positive";
}

function discoverGoFixtures(): ReadonlyArray<Fixture> {
  const out: Fixture[] = [];
  for (const p of PROVIDERS) {
    const dir = join(FIXTURE_ROOT, p, "go");
    let entries: ReadonlyArray<string>;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry);
      if (!statSync(abs).isFile() || !entry.endsWith(".go")) continue;
      const kind = entry.includes(".negative.")
        ? "negative"
        : entry.includes(".positive.")
          ? "positive"
          : null;
      if (kind === null) continue;
      out.push({ absPath: abs, relPath: relative(FIXTURE_ROOT, abs), provider: p, kind });
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

const CONFIG: Config = {
  reachability_max_depth: 3,
  scanned_at: "2026-06-04T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
};

let goRuntime: GoRuntime;
let ruleSet: RuleSet;

beforeAll(async () => {
  goRuntime = await initGoRuntime({ wasmBytes: new Uint8Array(readFileSync(resolveGoWasmPath())) });
  ruleSet = await loadRuleSet({
    rule_documents: BUNDLED_RULE_DOCUMENTS.map((d) => d.doc),
    predicates: ALL_PREDICATES,
    providers: PROVIDER_CATALOG,
    rule_pack_version: RULES_PACK_VERSION,
  });
}, 30_000);

async function scanFixture(fx: Fixture): Promise<{
  handlerCount: number;
  states: ReadonlyArray<string>;
  highCritFps: ReadonlyArray<{ rule_id: string; severity: string; state: string }>;
}> {
  const parsedFile: ParsedFile = await parseGo(
    { file_path: fx.relPath, source_text: readFileSync(fx.absPath, "utf8") },
    goRuntime,
  );
  const model = await buildProjectModel({
    parsedFiles: [parsedFile],
    ruleSet,
    config: CONFIG,
    bespokeAdapters: ALL_ADAPTERS,
  });
  const result = await evaluate(model, ruleSet, CONFIG);
  const highCritFps = result.findings
    .filter((f) => (f.severity === "high" || f.severity === "critical") && f.state !== "verified" && f.state !== "manual-review")
    .map((f) => ({ rule_id: f.rule_id, severity: f.severity, state: f.state }));
  // The evaluator emits per-rule findings; the handler's verdict is the worst/positive STATE across
  // its findings (verified is emitted by library-verified, not-verified by the timing rule).
  return {
    handlerCount: model.handlers.length,
    states: result.findings.map((f) => f.state),
    highCritFps,
  };
}

describe("RULES-06 — Go corpus FP measurement (<5%)", () => {
  it("measures FP rate on .negative. fixtures and writes the result artifact", async () => {
    const fixtures = discoverGoFixtures();
    const negatives = fixtures.filter((f) => f.kind === "negative");
    const positives = fixtures.filter((f) => f.kind === "positive");
    expect(negatives.length).toBeGreaterThan(0);

    const perFixture: Array<Record<string, unknown>> = [];
    const perRule = new Map<string, number>();
    let falsePositiveCount = 0;
    let verifiedNegatives = 0;

    for (const fx of negatives) {
      const { states, highCritFps } = await scanFixture(fx);
      if (states.includes("verified")) verifiedNegatives++;
      const isFp = highCritFps.length > 0;
      if (isFp) falsePositiveCount++;
      for (const f of highCritFps) perRule.set(f.rule_id, (perRule.get(f.rule_id) ?? 0) + 1);
      perFixture.push({
        relPath: fx.relPath,
        provider: fx.provider,
        handler_states: states,
        false_positive_findings: highCritFps,
        is_false_positive: isFp,
      });
    }

    // Anti-vacuous guard: at least one negative per the SDK providers must actually render verified
    // (proves detection + attribution + library-verified are wired — not a 0-handler vacuous pass).
    expect(verifiedNegatives).toBeGreaterThanOrEqual(3); // stripe + github + svix SDK fixtures

    // The .positive. broken fixtures MUST flag critical not-verified (the rule fires both directions).
    for (const fx of positives) {
      const { states } = await scanFixture(fx);
      expect(states).toContain("not-verified");
    }

    const fpRate = falsePositiveCount / negatives.length;
    const sortedPerRule = Array.from(perRule.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([rule_id, count]) => ({ rule_id, false_positive_count: count }));

    const artefact = {
      measured_at: CONFIG.scanned_at,
      total_negative_fixtures: negatives.length,
      verified_negatives: verifiedNegatives,
      positive_fixtures: positives.length,
      false_positives: falsePositiveCount,
      false_positive_rate: Number(fpRate.toFixed(4)),
      pass_threshold: 0.05,
      pass: fpRate <= 0.05,
      per_rule_breakdown: sortedPerRule,
      per_fixture: perFixture.sort((a, b) =>
        String(a.relPath).localeCompare(String(b.relPath)),
      ),
      severity_filter: ["high", "critical"],
      excluded_states: ["verified", "manual-review"],
    };
    writeFileSync(RESULT_PATH, `${JSON.stringify(artefact, null, 2)}\n`, "utf8");

    if (fpRate > 0.05) {
      const lines = sortedPerRule.map((r) => `  - ${r.rule_id}: ${r.false_positive_count}`).join("\n");
      throw new Error(
        `RULES-06 GATE FAILED: ${falsePositiveCount}/${negatives.length} = ${(fpRate * 100).toFixed(2)}% (>5%).\nPer-rule:\n${lines}\nSee ${RESULT_PATH}.`,
      );
    }
    expect(fpRate).toBeLessThanOrEqual(0.05);
  });
});
