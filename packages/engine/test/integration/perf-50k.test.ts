import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ALL_ADAPTERS,
  buildProjectModel,
  type Config,
  evaluate,
  initPythonRuntime,
  type ParsedFile,
  type ProjectModel,
  type ProviderCatalog,
  type PythonRuntime,
  parseJsTs,
  parsePython,
  type RulePredicate,
  type RuleSet,
  type WebhookHandler,
} from "../../src/index.js";
import { resolvePythonWasmPath } from "../wasm.js";

// Resolve the fixture from this file's location, then walk to the workspace root.
// test/integration/perf-50k.test.ts → up 3 to packages/engine, up 2 more to workspace root.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, "..", "..", "..", "..", "e2e", "fixtures", "perf", "generated");

const TEST_CATALOG: ProviderCatalog = {
  github: {
    signature_header: ["x-hub-signature-256"],
    sdk_packages: ["@octokit/webhooks-methods"],
    sdk_verify_calls: ["verify"],
    secret_env_prefix: ["GITHUB_WEBHOOK"],
    secret_literal_prefix: ["ghs_"],
    conventional_paths: ["/webhooks/github"],
  },
};

// Inline predicate (same shape as @hookwarden/rules' github-timing-safe-equal): emits
// 'verified' when reachable_symbols include the @octokit verifier or crypto.timingSafeEqual,
// 'not-verified' otherwise. Returns null for non-github handlers.
const githubVerifyPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  const reaches = handler.reachable_symbols.some(
    (s) =>
      s.import_source === "@octokit/webhooks-methods" ||
      s.import_source === "@octokit/webhooks" ||
      s.qualified_name === "crypto.timingSafeEqual" ||
      s.qualified_name.endsWith(".timingSafeEqual"),
  );
  return reaches ? "verified" : "not-verified";
};

const RULESET: RuleSet = {
  schema_version: 1,
  rule_pack_version: "0.0.1",
  providers: TEST_CATALOG,
  rules: [
    {
      rule_id: "github/missing-timing-safe-equal",
      provider: "github",
      severity: "critical",
      emits_state: "not-verified",
      message: "missing verification",
      matcher: null,
      predicate_name: "github-timing-safe-equal",
      applies_to: ["express", "hono", "fastify", "nextjs"],
      provider_docs_url:
        "https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries",
      path_severity_overrides: null,
    },
  ],
  predicates: { "github-timing-safe-equal": githubVerifyPredicate },
};

function listFiles(root: string): ReadonlyArray<string> {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  walk(root);
  return out;
}

let runtime: PythonRuntime;

beforeAll(async () => {
  // Auto-generate the fixture if missing — the generated tree is gitignored, so CI runners
  // (and clean local clones) won't have it. Generation is fast (~150ms for 384 files).
  if (!existsSync(FIXTURE_ROOT)) {
    const { generate } = await import("../../../../e2e/fixtures/perf/generate.js");
    await generate();
  }
  runtime = await initPythonRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePythonWasmPath())),
  });
}, 60_000);

describe("Phase 2 perf + coverage on the 50K-LOC fixture (ENGINE-06 + ENGINE-09 + ENGINE-07)", () => {
  it("scans the full fixture in under 30 seconds and emits internally consistent ScanResult", async () => {
    const start = performance.now();
    const allFiles = listFiles(FIXTURE_ROOT);
    expect(allFiles.length).toBeGreaterThan(280);

    // 1. Parse every file.
    const parsedFiles: ParsedFile[] = [];
    for (const abs of allFiles) {
      const rel = relative(FIXTURE_ROOT, abs);
      const text = readFileSync(abs, "utf8");
      if (
        abs.endsWith(".ts") ||
        abs.endsWith(".tsx") ||
        abs.endsWith(".js") ||
        abs.endsWith(".jsx")
      ) {
        parsedFiles.push(await parseJsTs({ file_path: rel, source_text: text }));
      } else if (abs.endsWith(".py")) {
        parsedFiles.push(await parsePython({ file_path: rel, source_text: text }, runtime));
      }
    }

    // 2. Build ProjectModel with bespoke adapters wired in.
    const config: Config = {
      reachability_max_depth: 3,
      scanned_at: "2026-05-02T00:00:00Z",
      engine_commit_sha: null,
      total_files_count: parsedFiles.length,
    };
    const model = await buildProjectModel({
      parsedFiles,
      ruleSet: RULESET,
      config,
      bespokeAdapters: ALL_ADAPTERS,
    });

    // 3. Evaluate.
    const result = await evaluate(model, RULESET, config);
    const elapsedMs = performance.now() - start;

    // ENGINE-06: under 30 seconds.
    expect(elapsedMs).toBeLessThan(30_000);

    // ENGINE-09: every framework appears in inventory.
    const frameworksInInventory = new Set(result.inventory.map((h) => h.framework));
    for (const fw of [
      "express",
      "hono",
      "fastify",
      "nextjs",
      "flask",
      "fastapi",
      "django",
    ] as const) {
      expect(frameworksInInventory.has(fw), `framework ${fw} missing from inventory`).toBe(true);
    }

    // Issue #8 fix: at least one FastAPI handler must resolve to a /webhooks-prefixed route.
    // Catches future drift in either the include_router cross-file scan or the fixture
    // generator's variable naming.
    const fastapiHandlers = result.inventory.filter((h) => h.framework === "fastapi");
    expect(fastapiHandlers.length).toBeGreaterThan(0);
    const fastapiPrefixed = fastapiHandlers.filter((h) => h.route_pattern.startsWith("/webhooks"));
    expect(
      fastapiPrefixed.length,
      "no FastAPI handler resolved a /webhooks prefix — include_router cross-file scan likely broken",
    ).toBeGreaterThan(0);

    // ENGINE-07: parse-error file surfaces as a parse-error finding.
    const parseErrors = result.findings.filter((f) => f.rule_id === "engine/parse-error");
    expect(parseErrors.length).toBeGreaterThanOrEqual(1);
    expect(parseErrors[0]?.severity).toBe("high");

    // ENGINE-08: metadata is populated.
    expect(result.metadata.engine_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.metadata.rule_pack_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metadata.parse_errors_count).toBeGreaterThanOrEqual(1);
    expect(result.metadata.parsed_files_count).toBeGreaterThan(280);

    // At least one Finding is `verified` (the verified-via-SDK file).
    const verified = result.findings.filter((f) => f.state === "verified");
    expect(verified.length).toBeGreaterThanOrEqual(1);

    // Every Finding has a stable hex fingerprint.
    for (const f of result.findings) {
      expect(f.id).toMatch(/^[0-9a-f]{64}$/);
      expect(f.primary_location_line_hash).toMatch(/^[0-9a-f]{64}$/);
    }

    // No Finding's snippet contains a literal string from a known secret prefix
    // (D-39 redaction property; spot-check on `whsec_` / `ghs_`).
    for (const f of result.findings) {
      expect(f.snippet).not.toMatch(/whsec_[a-zA-Z0-9]+/);
      expect(f.snippet).not.toMatch(/ghs_[a-zA-Z0-9]+/);
    }
  }, 90_000);
});
