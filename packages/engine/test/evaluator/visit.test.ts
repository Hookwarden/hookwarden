import { describe, expect, it } from "vitest";
import { evaluateRulesForHandler } from "../../src/evaluator/visit.js";
import { buildProjectModel } from "../../src/model/build.js";
import { parseJsTs } from "../../src/parsers/babel.js";
import type {
  ProjectModel,
  WebhookHandler,
} from "../../src/types/index.js";
import type { RulePredicate, RuleSet } from "../../src/types/rule-set.js";

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

// Minimal inline predicate — same observable shape as the real
// @hookwarden/rules github-timing-safe-equal: returns 'verified' when the handler reaches
// the SDK verifier, 'not-verified' otherwise, null for non-github handlers.
const githubVerifyPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  const reaches = handler.reachable_symbols.some(
    (s) =>
      s.qualified_name === "crypto.timingSafeEqual" ||
      s.qualified_name.endsWith(".timingSafeEqual") ||
      s.import_source === "@octokit/webhooks" ||
      s.import_source === "@octokit/webhooks-methods",
  );
  return reaches ? "verified" : "not-verified";
};

const RULE = {
  rule_id: "github/missing-timing-safe-equal",
  provider: "github",
  severity: "critical" as const,
  emits_state: "not-verified" as const,
  message: "missing verification",
  matcher: null,
  predicate_name: "github-timing-safe-equal",
  applies_to: ["express"] as const,
} as const;

function makeRuleSet(applies_to: ReadonlyArray<string> | "all" = ["express"]): RuleSet {
  return {
    schema_version: 1,
    rule_pack_version: "0.0.1",
    providers: TEST_CATALOG,
    rules: [{ ...RULE, applies_to: applies_to as RULE["applies_to"] }],
    predicates: { "github-timing-safe-equal": githubVerifyPredicate },
  };
}

const CONFIG = {
  reachability_max_depth: 3,
  scanned_at: "2026-05-02T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
} as const;

describe("evaluateRulesForHandler — predicate-driven rule (D-28 + D-29)", () => {
  it("emits not-verified Finding when predicate returns not-verified", async () => {
    const ruleSet = makeRuleSet();
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', (req, res) => { res.send('ok'); });\n",
    });
    const model = await buildProjectModel({ parsedFiles: [file], ruleSet, config: CONFIG });
    const out = await evaluateRulesForHandler({ handler: model.handlers[0]!, ruleSet, model });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.state).toBe("not-verified");
    expect(out.findings[0]?.rule_id).toBe("github/missing-timing-safe-equal");
    expect(out.worst_state).toBe("not-verified");
  });

  it("emits verified Finding when handler reaches the SDK verifier", async () => {
    const ruleSet = makeRuleSet();
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import { verify } from '@octokit/webhooks-methods';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', async (req, res) => {\n" +
        "  await verify('x', req.body, req.headers['x-hub-signature-256']);\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const model = await buildProjectModel({ parsedFiles: [file], ruleSet, config: CONFIG });
    const out = await evaluateRulesForHandler({ handler: model.handlers[0]!, ruleSet, model });
    expect(out.findings[0]?.state).toBe("verified");
    expect(out.worst_state).toBe("verified");
  });

  it("does not run rules whose applies_to excludes the framework", async () => {
    const ruleSet = makeRuleSet(["fastify"]);
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express'; const app = express(); app.post('/webhooks/github', (req, res) => res.send('ok'));",
    });
    const model = await buildProjectModel({ parsedFiles: [file], ruleSet, config: CONFIG });
    const out = await evaluateRulesForHandler({ handler: model.handlers[0]!, ruleSet, model });
    expect(out.findings).toEqual([]);
  });
});
