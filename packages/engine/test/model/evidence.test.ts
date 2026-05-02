import { describe, expect, it } from "vitest";
import { detectCatalogHandlers } from "../../src/model/catalog.js";
import { computeEvidence } from "../../src/model/evidence.js";
import { parseJsTs } from "../../src/parsers/babel.js";
import type { ProviderCatalog } from "../../src/types/rule-set.js";

// Test fixture catalog — kept in sync with @hookwarden/rules/src/catalog.ts.
// We don't import from the rules workspace to keep the engine tests independent
// of the rules build (and to avoid the package dependency direction reversing).
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

describe("computeEvidence (D-32 — 6 of 7 signals; sdk_verify_call emitted in Plan 06b)", () => {
  it("emits path_pattern_match, sdk_import, signature_header_read, secret_literal_match for a Stripe webhook", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import Stripe from 'stripe';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', (req, res) => {\n" +
        "  const sig = req.headers['stripe-signature'];\n" +
        "  const secret = 'whsec_xyz';\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const handlers = detectCatalogHandlers(file);
    const { evidence, provider } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: TEST_CATALOG,
      imports: file.imports,
    });
    const kinds = evidence.map((e) => e.kind);
    expect(kinds).toContain("path_pattern_match");
    expect(kinds).toContain("sdk_import");
    expect(kinds).toContain("signature_header_read");
    expect(kinds).toContain("secret_literal_match");
    expect(provider).toBe("stripe");
  });

  it("emits secret_env_var_reference when STRIPE_WEBHOOK env var is referenced inside the handler", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', (req, res) => {\n" +
        "  const secret = process.env.STRIPE_WEBHOOK_SECRET;\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: TEST_CATALOG,
      imports: file.imports,
    });
    expect(
      evidence.some((e) => e.kind === "secret_env_var_reference" && e.detail === "STRIPE_WEBHOOK"),
    ).toBe(true);
  });

  it("emits body_as_bytes_or_buffer when handler reads raw bytes", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', (req, res) => {\n" +
        "  const buf: Buffer = req.body;\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: TEST_CATALOG,
      imports: file.imports,
    });
    expect(evidence.some((e) => e.kind === "body_as_bytes_or_buffer")).toBe(true);
  });

  it("does NOT emit sdk_verify_call here — that is Plan 06b's responsibility", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import Stripe from 'stripe';\n" +
        "const s = new Stripe('k');\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', (req, res) => {\n" +
        "  s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], 'whsec_x');\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: TEST_CATALOG,
      imports: file.imports,
    });
    expect(evidence.some((e) => e.kind === "sdk_verify_call")).toBe(false);
  });

  it("provider attribution returns 'unknown' when no catalog signal matches", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/custom', (req, res) => res.send('ok'));\n",
    });
    const handlers = detectCatalogHandlers(file);
    const { provider } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: TEST_CATALOG,
      imports: file.imports,
    });
    expect(provider).toBe("unknown");
  });
});
