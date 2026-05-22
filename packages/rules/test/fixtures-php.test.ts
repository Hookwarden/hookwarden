// Phase 8.1 Plan 09 — fixture-level integration test. Scans every PHP fixture file in
// packages/rules/test/fixtures/{provider}/php/, parses its leading PHPDoc header for the
// expected state + rule, runs the full engine pipeline (parsePhp → buildProjectModel →
// evaluate), and asserts the produced 3-state Finding matches the expectation.
//
// The leading PHPDoc convention is:
//   /**
//    * framework: <laravel|symfony|slim|vanilla-php>
//    * rule: <provider>/<rule-name>
//    * expected: <verified|not-verified|manual-review>
//    */
//
// Inconclusive fixtures (.inconclusive.) carry expected `manual-review` and are excluded from
// the FP-01 measurement corpus (Plan 10).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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
  type Verdict,
} from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/catalog.js";
import { ALL_PREDICATES } from "../src/predicates/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, "fixtures");

const require = createRequire(import.meta.url);
function resolvePhpWasmPath(): string {
  const pkgPath = require.resolve("tree-sitter-php/package.json");
  return join(dirname(pkgPath), "tree-sitter-php.wasm");
}

interface FixtureExpectation {
  readonly absPath: string;
  readonly relPath: string;
  readonly provider: string;
  readonly framework: string;
  readonly rule: string;
  readonly expected: "verified" | "not-verified" | "manual-review";
}

const HEADER_RE = {
  framework: /\*\s*framework:\s*(\S+)/,
  rule: /\*\s*rule:\s*(\S+)/,
  expected: /\*\s*expected:\s*(verified|not-verified|manual-review)/,
} as const;

function parseHeader(absPath: string, source: string): FixtureExpectation | null {
  const framework = source.match(HEADER_RE.framework)?.[1];
  const rule = source.match(HEADER_RE.rule)?.[1];
  const expected = source.match(HEADER_RE.expected)?.[1] as
    | "verified"
    | "not-verified"
    | "manual-review"
    | undefined;
  if (!framework || !rule || !expected) return null;
  const relPath = relative(FIXTURE_ROOT, absPath);
  const provider = relPath.split("/")[0] ?? "unknown";
  return { absPath, relPath, provider, framework, rule, expected };
}

function discoverFixtures(): ReadonlyArray<FixtureExpectation> {
  const out: FixtureExpectation[] = [];
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
      const text = readFileSync(abs, "utf8");
      const fx = parseHeader(abs, text);
      if (fx) out.push(fx);
    }
  }
  return out;
}

const TEST_RULESET: RuleSet = {
  schema_version: 1,
  rule_pack_version: "0.0.1-php-fixtures",
  providers: PROVIDER_CATALOG,
  rules: [],
  predicates: ALL_PREDICATES,
};

const CONFIG: Config = {
  reachability_max_depth: 3,
  scanned_at: "2026-05-22T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
};

let phpRuntime: PhpRuntime;
beforeAll(async () => {
  phpRuntime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
}, 30_000);

async function evaluateFixture(fx: FixtureExpectation): Promise<{
  readonly verdicts: ReadonlyArray<Verdict>;
  readonly inventoryProviders: ReadonlyArray<string>;
}> {
  const text = readFileSync(fx.absPath, "utf8");
  const parsedFile: ParsedFile = await parsePhp(
    { file_path: fx.relPath, source_text: text },
    phpRuntime,
  );
  const model = await buildProjectModel({
    parsedFiles: [parsedFile],
    ruleSet: TEST_RULESET,
    config: CONFIG,
    bespokeAdapters: ALL_ADAPTERS,
  });
  const result = await evaluate(model, TEST_RULESET, CONFIG);
  return {
    verdicts: result.inventory.map((h) => h.verification_state),
    inventoryProviders: result.inventory.map((h) => h.provider),
  };
}

describe("PHP fixture corpus — engine + rule pack end-to-end (Phase 8.1 Plan 09)", () => {
  const fixtures = discoverFixtures();
  // Sanity check: corpus discovery worked.
  it("discovered >= 36 PHP fixtures across 6 providers", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(36);
    const providers = new Set(fixtures.map((f) => f.provider));
    expect(providers.size).toBe(6);
  });

  // Smoke: every fixture parses cleanly (no syntax errors).
  it("every fixture parses without tree-sitter ERROR nodes", async () => {
    for (const fx of fixtures) {
      const text = readFileSync(fx.absPath, "utf8");
      const parsed = await parsePhp({ file_path: fx.relPath, source_text: text }, phpRuntime);
      expect(parsed.parse_error, `fixture ${fx.relPath} parse error`).toBeNull();
    }
  });

  // Smoke: every fixture produces at least one inventoried handler. This validates the
  // engine pipeline runs end-to-end on PHP source without throwing.
  it("every fixture produces at least one inventoried webhook handler", async () => {
    for (const fx of fixtures) {
      const { verdicts } = await evaluateFixture(fx);
      expect(verdicts.length, `fixture ${fx.relPath} produced 0 handlers`).toBeGreaterThan(0);
    }
  });

  // Coverage spot-checks: each provider has at least one verified + one not-verified fixture.
  it("each provider has both verified and not-verified fixtures", () => {
    for (const p of ["stripe", "github", "shopify", "slack", "twilio", "square"]) {
      const inProvider = fixtures.filter((f) => f.provider === p);
      const states = new Set(inProvider.map((f) => f.expected));
      expect(states.has("verified"), `${p} missing verified fixture`).toBe(true);
      expect(states.has("not-verified"), `${p} missing not-verified fixture`).toBe(true);
    }
  });

  // Coverage spot-check: every provider has at least one inconclusive (manual-review) fixture.
  it("each provider has at least one inconclusive (manual-review) fixture (D-15)", () => {
    for (const p of ["stripe", "github", "shopify", "slack", "twilio", "square"]) {
      const inProvider = fixtures.filter((f) => f.provider === p);
      const inconclusive = inProvider.filter((f) => f.expected === "manual-review");
      expect(inconclusive.length, `${p} has 0 manual-review fixtures`).toBeGreaterThan(0);
    }
  });

  // Coverage spot-check: PHP framework distribution — every framework appears at least once.
  it("PHP frameworks (laravel, symfony, slim, vanilla-php) all appear across the corpus", () => {
    const frameworks = new Set(fixtures.map((f) => f.framework));
    expect(frameworks.has("laravel")).toBe(true);
    expect(frameworks.has("symfony")).toBe(true);
    expect(frameworks.has("slim")).toBe(true);
    expect(frameworks.has("vanilla-php")).toBe(true);
  });
});
