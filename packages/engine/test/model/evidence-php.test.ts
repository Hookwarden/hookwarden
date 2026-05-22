// Phase 8.1 Plan 07: PHP-aware evidence detection.
// computeEvidence is language-agnostic and runs against catalog data; this test exercises
// the PHP-specific extensions added in Plan 07:
//   - signature_header_read recognises `$_SERVER['HTTP_STRIPE_SIGNATURE']` via underscore-form
//   - sdk_import recognises PHP namespace imports via prefix-match on catalog entries with `\`
//   - body_as_bytes_or_buffer recognises `file_get_contents('php://input')` and `->getBody()` etc.
//   - secret_env_var_reference / secret_literal_match work via substring (already PHP-friendly)

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { detectCatalogHandlers } from "../../src/model/catalog.js";
import { computeEvidence } from "../../src/model/evidence.js";
import { parsePhp } from "../../src/parsers/php.js";
import { initPhpRuntime, type PhpRuntime } from "../../src/parsers/php-loader.js";
import type { ProviderCatalog } from "../../src/types/rule-set.js";
import { resolvePhpWasmPath } from "../wasm.js";

let runtime: PhpRuntime;
beforeAll(async () => {
  runtime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
}, 30_000);

// Mirror of the production PHP catalog additions (Phase 8.1 Plan 07).
const PHP_CATALOG: ProviderCatalog = {
  stripe: {
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe", "@stripe/stripe-js", "Stripe\\"],
    sdk_verify_calls: [
      "webhooks.constructEvent",
      "Webhook.constructEvent",
      "Stripe\\Webhook::constructEvent",
      "Webhook::constructEvent",
    ],
    secret_env_prefix: ["STRIPE_WEBHOOK", "STRIPE_SIGNING"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: ["/webhooks/stripe", "/api/webhooks/stripe"],
  },
  github: {
    signature_header: ["x-hub-signature-256", "x-hub-signature"],
    sdk_packages: ["@octokit/webhooks"],
    sdk_verify_calls: ["verify"],
    secret_env_prefix: ["GITHUB_WEBHOOK"],
    secret_literal_prefix: ["ghs_"],
    conventional_paths: ["/webhooks/github"],
  },
  shopify: {
    signature_header: ["x-shopify-hmac-sha256"],
    sdk_packages: ["@shopify/shopify-api", "Shopify\\"],
    sdk_verify_calls: ["verifyHmac", "Shopify\\Utils::validateHmac"],
    secret_env_prefix: ["SHOPIFY_WEBHOOK"],
    secret_literal_prefix: [],
    conventional_paths: ["/webhooks/shopify"],
  },
  twilio: {
    signature_header: ["x-twilio-signature"],
    sdk_packages: ["twilio", "Twilio\\"],
    sdk_verify_calls: ["validate", "Twilio\\Security\\RequestValidator::validate"],
    secret_env_prefix: ["TWILIO_AUTH"],
    secret_literal_prefix: [],
    conventional_paths: ["/webhooks/twilio"],
  },
  square: {
    signature_header: ["x-square-hmacsha256-signature"],
    sdk_packages: ["square", "Square\\"],
    sdk_verify_calls: [
      "isValidWebhookEventSignature",
      "Square\\Utils\\WebhooksHelper::isValidWebhookEventSignature",
    ],
    secret_env_prefix: ["SQUARE_WEBHOOK"],
    secret_literal_prefix: [],
    conventional_paths: ["/webhooks/square"],
  },
  slack: {
    signature_header: ["x-slack-signature"],
    sdk_packages: ["@slack/bolt"],
    sdk_verify_calls: ["verifyRequestSignature"],
    secret_env_prefix: ["SLACK_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: ["/webhooks/slack"],
  },
};

describe("computeEvidence — PHP (Phase 8.1 Plan 07)", () => {
  it("emits signature_header_read for $_SERVER['HTTP_STRIPE_SIGNATURE'] (underscore-form)", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'];\n" +
          "  return 'ok';\n" +
          "});\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers.length).toBeGreaterThan(0);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: PHP_CATALOG,
      imports: file.imports,
    });
    expect(evidence.some((e) => e.kind === "signature_header_read" && e.provider === "stripe")).toBe(
      true,
    );
  });

  it("emits sdk_import for `use Stripe\\Webhook` via namespace-prefix match on catalog `Stripe\\`", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\n" +
          "use Illuminate\\Support\\Facades\\Route;\n" +
          "use Stripe\\Webhook;\n" +
          "Route::post('/webhooks/stripe', fn ($req) => 'ok');\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers.length).toBeGreaterThan(0);
    const { evidence, provider } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: PHP_CATALOG,
      imports: file.imports,
    });
    expect(evidence.some((e) => e.kind === "sdk_import" && e.provider === "stripe")).toBe(true);
    expect(provider).toBe("stripe");
  });

  it("emits body_as_bytes_or_buffer for file_get_contents('php://input')", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $body = file_get_contents('php://input');\n" +
          "  return 'ok';\n" +
          "});\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: PHP_CATALOG,
      imports: file.imports,
    });
    expect(evidence.some((e) => e.kind === "body_as_bytes_or_buffer")).toBe(true);
  });

  it("emits body_as_bytes_or_buffer for $request->getContent() (Laravel/Symfony)", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $body = $request->getContent();\n" +
          "  return 'ok';\n" +
          "});\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: PHP_CATALOG,
      imports: file.imports,
    });
    expect(evidence.some((e) => e.kind === "body_as_bytes_or_buffer")).toBe(true);
  });

  it("emits secret_env_var_reference for getenv('STRIPE_WEBHOOK_SECRET') via substring", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $secret = getenv('STRIPE_WEBHOOK_SECRET');\n" +
          "  return 'ok';\n" +
          "});\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: PHP_CATALOG,
      imports: file.imports,
    });
    expect(
      evidence.some(
        (e) =>
          e.kind === "secret_env_var_reference" &&
          e.provider === "stripe" &&
          e.detail === "STRIPE_WEBHOOK",
      ),
    ).toBe(true);
  });

  it("emits secret_literal_match for whsec_ prefix in PHP source", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $secret = 'whsec_abc123';\n" +
          "  return 'ok';\n" +
          "});\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: PHP_CATALOG,
      imports: file.imports,
    });
    expect(
      evidence.some((e) => e.kind === "secret_literal_match" && e.provider === "stripe"),
    ).toBe(true);
  });

  it("emits path_pattern_match for /webhooks/stripe Laravel route", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', fn ($r) => 'ok');\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: PHP_CATALOG,
      imports: file.imports,
    });
    expect(
      evidence.some((e) => e.kind === "path_pattern_match" && e.provider === "stripe"),
    ).toBe(true);
  });

  it("recognises Shopify, Twilio, and Square PHP namespace imports", async () => {
    const cases: ReadonlyArray<{ provider: string; useStmt: string }> = [
      { provider: "shopify", useStmt: "use Shopify\\Utils;" },
      { provider: "twilio", useStmt: "use Twilio\\Security\\RequestValidator;" },
      { provider: "square", useStmt: "use Square\\Utils\\WebhooksHelper;" },
    ];
    for (const { provider, useStmt } of cases) {
      const file = await parsePhp(
        {
          file_path: "routes/api.php",
          source_text:
            `<?php\nuse Illuminate\\Support\\Facades\\Route;\n${useStmt}\n` +
            `Route::post('/webhooks/${provider}', fn ($r) => 'ok');\n`,
        },
        runtime,
      );
      const handlers = detectCatalogHandlers(file);
      expect(handlers.length, `provider ${provider}`).toBeGreaterThan(0);
      const { evidence } = computeEvidence({
        handler: handlers[0]!,
        parsedFile: file,
        providerCatalog: PHP_CATALOG,
        imports: file.imports,
      });
      expect(
        evidence.some((e) => e.kind === "sdk_import" && e.provider === provider),
        `provider ${provider} sdk_import`,
      ).toBe(true);
    }
  });

  it("does NOT emit sdk_import for a PHP file with no framework or vendor imports", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', fn ($r) => 'ok');\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    const { evidence } = computeEvidence({
      handler: handlers[0]!,
      parsedFile: file,
      providerCatalog: PHP_CATALOG,
      imports: file.imports,
    });
    // Illuminate is not in any sdk_packages entry → sdk_import must be empty.
    expect(evidence.some((e) => e.kind === "sdk_import")).toBe(false);
  });
});
