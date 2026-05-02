import { describe, expect, it } from "vitest";
import { applyMatcher } from "../../src/evaluator/matchers.js";
import { buildProjectModel } from "../../src/model/build.js";
import { parseJsTs } from "../../src/parsers/babel.js";
import type { ProviderCatalog, RuleSet } from "../../src/types/rule-set.js";

const TEST_CATALOG: ProviderCatalog = {
  stripe: {
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe", "@stripe/stripe-js"],
    sdk_verify_calls: ["webhooks.constructEvent"],
    secret_env_prefix: ["STRIPE_WEBHOOK"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: ["/webhooks/stripe"],
  },
  github: {
    signature_header: ["x-hub-signature-256"],
    sdk_packages: ["@octokit/webhooks-methods"],
    sdk_verify_calls: ["verify"],
    secret_env_prefix: ["GITHUB_WEBHOOK"],
    secret_literal_prefix: ["ghs_"],
    conventional_paths: ["/webhooks/github"],
  },
};

const TEST_RULESET: RuleSet = {
  schema_version: 1,
  rule_pack_version: "0.0.1",
  providers: TEST_CATALOG,
  rules: [],
  predicates: {},
};

const CONFIG = {
  reachability_max_depth: 3,
  scanned_at: "2026-05-02T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
} as const;

async function makeModel(sourceText: string) {
  const file = await parseJsTs({ file_path: "x.ts", source_text: sourceText });
  const model = await buildProjectModel({
    parsedFiles: [file],
    ruleSet: TEST_RULESET,
    config: CONFIG,
  });
  return { model, handler: model.handlers[0]! };
}

describe("applyMatcher — argumentEquals (issue #6 — was a silent no-op, now implemented)", () => {
  it("emits not-verified when handler calls verify('') (empty signing secret)", async () => {
    const { model, handler } = await makeModel(
      "import express from 'express';\n" +
        "import { verify } from '@octokit/webhooks-methods';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', async (req, res) => {\n" +
        "  await verify('', req.body, req.headers['x-hub-signature-256']);\n" +
        "  res.send('ok');\n" +
        "});\n",
    );
    const verdict = applyMatcher({
      matcher: { name: "argumentEquals", args: { call: "verify", arg_index: 0, equals: "" } },
      handler,
      model,
      providers: TEST_CATALOG,
      emits_state: "not-verified",
    });
    expect(verdict).toBe("not-verified");
  });

  it("returns null when the call has a non-empty literal as argN", async () => {
    const { model, handler } = await makeModel(
      "import express from 'express';\n" +
        "import { verify } from '@octokit/webhooks-methods';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', async (req, res) => {\n" +
        "  await verify('whsec_x', req.body, req.headers['x-hub-signature-256']);\n" +
        "  res.send('ok');\n" +
        "});\n",
    );
    const verdict = applyMatcher({
      matcher: { name: "argumentEquals", args: { call: "verify", arg_index: 0, equals: "" } },
      handler,
      model,
      providers: TEST_CATALOG,
      emits_state: "not-verified",
    });
    // Call exists but arg differs → matcher does not apply.
    expect(verdict).toBeNull();
  });

  it("returns null when the named call is not reachable from the handler", async () => {
    const { model, handler } = await makeModel(
      "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', (req, res) => res.send('ok'));\n",
    );
    const verdict = applyMatcher({
      matcher: { name: "argumentEquals", args: { call: "verify", arg_index: 0, equals: "" } },
      handler,
      model,
      providers: TEST_CATALOG,
      emits_state: "not-verified",
    });
    expect(verdict).toBeNull();
  });
});

describe("applyMatcher — other matchers (smoke)", () => {
  it("importMissing fires when module is absent", async () => {
    const { model, handler } = await makeModel(
      "import express from 'express';\nconst app = express();\napp.post('/webhooks/x', (req, res) => res.send('ok'));\n",
    );
    const verdict = applyMatcher({
      matcher: { name: "importMissing", args: { module: "stripe" } },
      handler,
      model,
      providers: TEST_CATALOG,
      emits_state: "not-verified",
    });
    expect(verdict).toBe("not-verified");
  });

  it("callMatches fires when reachable_symbols includes the qualified name", async () => {
    const { model, handler } = await makeModel(
      "import express from 'express';\n" +
        "import Stripe from 'stripe';\n" +
        "const s = new Stripe('k');\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', (req, res) => {\n" +
        "  s.webhooks.constructEvent(req.body, '', '');\n" +
        "  res.send('ok');\n" +
        "});\n",
    );
    const verdict = applyMatcher({
      matcher: { name: "callMatches", args: { qualified_name: "constructEvent" } },
      handler,
      model,
      providers: TEST_CATALOG,
      emits_state: "verified",
    });
    expect(verdict).toBe("verified");
  });

  it("middlewareOrder fires when express.json appears before the auth middleware", async () => {
    const { model, handler } = await makeModel(
      "import express from 'express';\n" +
        "import auth from 'auth-mw';\n" +
        "const app = express();\n" +
        "app.use(express.json());\n" +
        "app.post('/webhooks/x', auth, (req, res) => res.send('ok'));\n",
    );
    const verdict = applyMatcher({
      matcher: { name: "middlewareOrder", args: { before: "express.json", after: "auth" } },
      handler,
      model,
      providers: TEST_CATALOG,
      emits_state: "not-verified",
    });
    expect(verdict).toBe("not-verified");
  });
});
