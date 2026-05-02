import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import { buildProjectModel } from "../src/model/build.js";
import { parseJsTs } from "../src/parsers/babel.js";
import type {
  ProjectModel,
  WebhookHandler,
} from "../src/types/index.js";
import type { RulePredicate, RuleSet } from "../src/types/rule-set.js";

const TEST_CATALOG = {
  github: {
    signature_header: ["x-hub-signature-256"],
    sdk_packages: ["@octokit/webhooks-methods"],
    sdk_verify_calls: ["verify"],
    secret_env_prefix: ["GITHUB_WEBHOOK"],
    secret_literal_prefix: ["ghs_"],
    conventional_paths: ["/webhooks/github"],
  },
} as const;

const githubVerifyPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  const reaches = handler.reachable_symbols.some(
    (s) =>
      s.import_source === "@octokit/webhooks-methods" ||
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
      applies_to: ["express"],
    },
  ],
  predicates: { "github-timing-safe-equal": githubVerifyPredicate },
};

const CONFIG = {
  reachability_max_depth: 3,
  scanned_at: "2026-05-02T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 2,
} as const;

describe("evaluate (D-35 ScanResult + ENGINE-08 metadata + DISCOVERY-01 inventory)", () => {
  it("returns ScanResult with findings, inventory, metadata; parse_errors_count = 1 for one broken file", async () => {
    const ok = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', (req, res) => res.send('ok'));\n",
    });
    const broken = await parseJsTs({ file_path: "broken.ts", source_text: "const x = ;" });
    const model = await buildProjectModel({ parsedFiles: [ok, broken], ruleSet: RULESET, config: CONFIG });
    const result = await evaluate(model, RULESET, CONFIG);

    // Two findings: one parse-error (broken.ts) + one rule finding (github not-verified).
    expect(result.findings).toHaveLength(2);
    const parseErr = result.findings.find((f) => f.rule_id === "engine/parse-error");
    const ruleFinding = result.findings.find((f) => f.rule_id === "github/missing-timing-safe-equal");
    expect(parseErr).toBeDefined();
    expect(parseErr?.severity).toBe("high");
    expect(ruleFinding).toBeDefined();
    expect(ruleFinding?.state).toBe("not-verified");

    // DISCOVERY-01 inventory: one handler from the OK file. verification_state == not-verified.
    expect(result.inventory).toHaveLength(1);
    expect(result.inventory[0]?.verification_state).toBe("not-verified");
    expect(result.inventory[0]?.findings_ref).toContain(ruleFinding?.id);
    // Inventory entry must carry the full D-36 contract.
    const h = result.inventory[0]!;
    expect(typeof h.id).toBe("string");
    expect(typeof h.framework).toBe("string");
    expect(h.framework_version).toBeNull();
    expect(typeof h.route_pattern).toBe("string");
    expect(Array.isArray(h.http_methods)).toBe(true);
    expect(typeof h.file_path).toBe("string");
    expect(h.location).toMatchObject({ line: expect.any(Number), col: expect.any(Number) });
    expect(Array.isArray(h.evidence)).toBe(true);
    expect(Array.isArray(h.middleware_chain)).toBe(true);
    expect(Array.isArray(h.reachable_symbols)).toBe(true);
    expect(typeof h.redacted_snippet).toBe("string");

    // Metadata.
    expect(result.metadata.engine_version).toBe("0.0.1");
    expect(result.metadata.rule_pack_version).toBe("0.0.1");
    expect(result.metadata.rule_pack_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metadata.scanned_at).toBe("2026-05-02T00:00:00Z");
    expect(result.metadata.parse_errors_count).toBe(1);
    expect(result.metadata.parsed_files_count).toBe(1);
    expect(result.metadata.total_files_count).toBe(2);
  });

  it("is deterministic across runs (same input → same output)", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express'; const app = express(); app.post('/webhooks/github', (req, res) => res.send('ok'));",
    });
    const cfg = { ...CONFIG, total_files_count: 1 };
    const m1 = await buildProjectModel({ parsedFiles: [file], ruleSet: RULESET, config: cfg });
    const m2 = await buildProjectModel({ parsedFiles: [file], ruleSet: RULESET, config: cfg });
    const r1 = await evaluate(m1, RULESET, cfg);
    const r2 = await evaluate(m2, RULESET, cfg);
    expect(r1.findings[0]?.id).toBe(r2.findings[0]?.id);
    expect(r1.metadata.rule_pack_content_hash).toBe(r2.metadata.rule_pack_content_hash);
  });
});
