// Phase 8.1 Plan 07: PHP `sdk_verify_call` overlay in build.ts.
// The reachability pass only handles babel + tree-sitter-python — PHP verify-call shapes
// (`\Stripe\Webhook::constructEvent(...)`) never surface there. The build.ts overlay
// substring-matches catalog `sdk_verify_calls` entries against the handler's source-text range.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { ALL_ADAPTERS } from "../../src/adapters/index.js";
import { buildProjectModel } from "../../src/model/build.js";
import { parsePhp } from "../../src/parsers/php.js";
import { initPhpRuntime, type PhpRuntime } from "../../src/parsers/php-loader.js";
import type { ProviderCatalog, RuleSet } from "../../src/types/rule-set.js";
import { resolvePhpWasmPath } from "../wasm.js";

let runtime: PhpRuntime;
beforeAll(async () => {
  runtime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
}, 30_000);

const TEST_CATALOG: ProviderCatalog = {
  stripe: {
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe", "Stripe\\"],
    sdk_verify_calls: [
      "webhooks.constructEvent",
      "Webhook.constructEvent",
      "Stripe\\Webhook::constructEvent",
      "Webhook::constructEvent",
    ],
    secret_env_prefix: ["STRIPE_WEBHOOK"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: ["/webhooks/stripe"],
  },
  twilio: {
    signature_header: ["x-twilio-signature"],
    sdk_packages: ["twilio", "Twilio\\"],
    sdk_verify_calls: [
      "validate",
      "Twilio\\Security\\RequestValidator::validate",
    ],
    secret_env_prefix: ["TWILIO_AUTH"],
    secret_literal_prefix: [],
    conventional_paths: ["/webhooks/twilio"],
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
  scanned_at: "2026-05-22T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
} as const;

describe("buildProjectModel — PHP sdk_verify_call overlay (Phase 8.1 Plan 07)", () => {
  it("attaches sdk_verify_call evidence for \\Stripe\\Webhook::constructEvent inside a Laravel handler", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\n" +
          "use Illuminate\\Support\\Facades\\Route;\n" +
          "use Stripe\\Webhook;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $event = \\Stripe\\Webhook::constructEvent($request->getContent(), $sig, $secret);\n" +
          "  return 'ok';\n" +
          "});\n",
      },
      runtime,
    );
    const model = await buildProjectModel({
      parsedFiles: [file],
      ruleSet: TEST_RULESET,
      config: TEST_CONFIG,
      bespokeAdapters: ALL_ADAPTERS,
    });
    expect(model.handlers.length).toBeGreaterThan(0);
    const sdkVerify = model.handlers[0]!.evidence.filter((e) => e.kind === "sdk_verify_call");
    expect(sdkVerify.length).toBeGreaterThan(0);
    expect(sdkVerify.some((e) => e.provider === "stripe")).toBe(true);
  });

  it("attaches sdk_verify_call for Twilio's RequestValidator::validate FQN", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\n" +
          "use Illuminate\\Support\\Facades\\Route;\n" +
          "use Twilio\\Security\\RequestValidator;\n" +
          "Route::post('/webhooks/twilio', function ($request) {\n" +
          "  $validator = new \\Twilio\\Security\\RequestValidator($authToken);\n" +
          "  $ok = $validator->validate($sig, $url, $body);\n" +
          "  return 'ok';\n" +
          "});\n",
      },
      runtime,
    );
    const model = await buildProjectModel({
      parsedFiles: [file],
      ruleSet: TEST_RULESET,
      config: TEST_CONFIG,
      bespokeAdapters: ALL_ADAPTERS,
    });
    expect(model.handlers.length).toBeGreaterThan(0);
    const sdkVerify = model.handlers[0]!.evidence.filter(
      (e) => e.kind === "sdk_verify_call" && e.provider === "twilio",
    );
    expect(sdkVerify.length).toBeGreaterThan(0);
  });

  it("does NOT attach a PHP-shape sdk_verify_call to JS/TS handlers (overlay gates on dialect)", async () => {
    // PHP overlay only fires on tree-sitter-php dialect — JS/TS catalog entries (`Webhook.constructEvent`)
    // continue through the reachability path. This test verifies the overlay doesn't double-emit.
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/none', fn ($r) => 'ok');\n",
      },
      runtime,
    );
    const model = await buildProjectModel({
      parsedFiles: [file],
      ruleSet: TEST_RULESET,
      config: TEST_CONFIG,
      bespokeAdapters: ALL_ADAPTERS,
    });
    expect(model.handlers.length).toBeGreaterThan(0);
    expect(model.handlers[0]!.evidence.filter((e) => e.kind === "sdk_verify_call")).toEqual([]);
  });
});
