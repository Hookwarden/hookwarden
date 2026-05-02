import { describe, expect, it } from "vitest";
import { buildProjectModel } from "../../src/model/build.js";
import { parseJsTs } from "../../src/parsers/babel.js";
import type { ProviderCatalog, RuleSet } from "../../src/types/rule-set.js";

// Test fixture catalog — kept in sync with @hookwarden/rules/src/catalog.ts.
const TEST_CATALOG: ProviderCatalog = {
  stripe: {
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe", "@stripe/stripe-js"],
    sdk_verify_calls: [
      "webhooks.constructEvent",
      "Webhook.constructEvent",
      "Webhook.construct_event",
    ],
    secret_env_prefix: ["STRIPE_WEBHOOK", "STRIPE_SIGNING"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: [
      "/webhooks/stripe",
      "/api/webhooks/stripe",
      "/stripe/webhook",
      "/stripe/webhooks",
    ],
  },
  github: {
    signature_header: ["x-hub-signature-256", "x-hub-signature"],
    sdk_packages: ["@octokit/webhooks", "@octokit/webhooks-methods"],
    sdk_verify_calls: ["verify", "verifyRequest"],
    secret_env_prefix: ["GITHUB_WEBHOOK", "GH_WEBHOOK"],
    secret_literal_prefix: ["ghs_", "github_pat_"],
    conventional_paths: [
      "/webhooks/github",
      "/api/webhooks/github",
      "/github/webhook",
      "/github/webhooks",
    ],
  },
};

const TEST_RULESET: RuleSet = {
  schema_version: 1,
  rule_pack_version: "0.0.1",
  providers: TEST_CATALOG,
  rules: [],
  predicates: {},
};

const TEST_CONFIG = {
  reachability_max_depth: 3,
  scanned_at: "2026-05-02T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
} as const;

describe("buildProjectModel (D-25 + D-37 + DISCOVERY-01)", () => {
  it("emits a WebhookHandler with id, evidence (incl. sdk_verify_call), reachable_symbols, middleware_chain, redacted_snippet", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import { verify } from '@octokit/webhooks-methods';\n" +
        "import auth from 'auth-mw';\n" +
        "const app = express();\n" +
        "app.use(express.json());\n" +
        "app.post('/webhooks/github', auth, async (req, res) => {\n" +
        "  await verify('whsec_x', req.body, req.headers['x-hub-signature-256']);\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const model = await buildProjectModel({
      parsedFiles: [file],
      ruleSet: TEST_RULESET,
      config: TEST_CONFIG,
    });
    expect(model.handlers).toHaveLength(1);
    const h = model.handlers[0]!;
    expect(h.id).toMatch(/^[0-9a-f]{64}$/);
    expect(h.framework).toBe("express");
    expect(h.route_pattern).toBe("/webhooks/github");
    expect(h.provider).toBe("github");
    // 6 Plan 06a signals + sdk_verify_call from this plan's overlay.
    expect(h.evidence.some((e) => e.kind === "sdk_import")).toBe(true);
    expect(h.evidence.some((e) => e.kind === "signature_header_read")).toBe(true);
    expect(h.evidence.some((e) => e.kind === "sdk_verify_call" && e.detail === "verify")).toBe(true);
    // Middleware chain: express.json (from app.use) + auth (per-route arg).
    const mwNames = h.middleware_chain.map((m) => m.name);
    expect(mwNames).toContain("express.json");
    expect(mwNames).toContain("auth");
    // Reachability: verify is reachable.
    expect(h.reachable_symbols.some((r) => r.qualified_name === "verify")).toBe(true);
    // Redaction: literal value 'whsec_x' is gone, identifiers preserved.
    expect(h.redacted_snippet).not.toContain("whsec_x");
    expect(h.redacted_snippet).toContain("verify");
  });

  it("appends sdk_verify_call evidence even when the SDK call is reached via an intra-file helper", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import Stripe from 'stripe';\n" +
        "const s = new Stripe('k');\n" +
        "function check(body: string, sig: string) {\n" +
        "  return s.webhooks.constructEvent(body, sig, 'whsec_x');\n" +
        "}\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', (req, res) => {\n" +
        "  check(req.body, req.headers['stripe-signature'] as string);\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const model = await buildProjectModel({
      parsedFiles: [file],
      ruleSet: TEST_RULESET,
      config: TEST_CONFIG,
    });
    const h = model.handlers[0]!;
    // sdk_verify_call should fire because reachable_symbols includes constructEvent (via check).
    expect(
      h.evidence.some(
        (e) => e.kind === "sdk_verify_call" && e.detail === "webhooks.constructEvent",
      ),
    ).toBe(true);
  });

  it("skips files with parse_error (D-27)", async () => {
    const broken = await parseJsTs({ file_path: "broken.ts", source_text: "const x = ;" });
    const model = await buildProjectModel({
      parsedFiles: [broken],
      ruleSet: TEST_RULESET,
      config: TEST_CONFIG,
    });
    expect(model.handlers).toEqual([]);
  });
});
