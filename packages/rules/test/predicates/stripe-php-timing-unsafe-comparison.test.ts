// Phase 8.1 Plan 08 — tests for stripe-php-timing-unsafe-comparison predicate.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  initPhpRuntime,
  type ParsedFile,
  type PhpRuntime,
  type ProjectModel,
  parsePhp,
  type WebhookHandler,
} from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { stripePhpTimingUnsafeComparisonPredicate } from "../../src/predicates/stripe-php-timing-unsafe-comparison.js";

const require = createRequire(import.meta.url);
function resolvePhpWasmPath(): string {
  const pkgPath = require.resolve("tree-sitter-php/package.json");
  return join(dirname(pkgPath), "tree-sitter-php.wasm");
}

let runtime: PhpRuntime;
beforeAll(async () => {
  runtime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
}, 30_000);

function makeHandler(file: ParsedFile, provider: string): WebhookHandler {
  return {
    id: "h1",
    framework: "laravel",
    framework_version: null,
    route_pattern: "/webhooks/stripe",
    http_methods: ["POST"],
    file_path: file.file_path,
    location: { line: 1, col: 1, end_line: 1, end_col: 1 },
    handler_function_name: null,
    provider,
    verification_state: "manual-review",
    evidence: [],
    middleware_chain: [],
    reachable_symbols: [],
    findings_ref: [],
    redacted_snippet: "",
  };
}

function makeModel(file: ParsedFile): ProjectModel {
  return {
    parsed_files: [file],
    handlers: [],
    middleware_registrations: [],
    import_graph: [],
  };
}

describe("stripePhpTimingUnsafeComparisonPredicate", () => {
  it("emits not-verified for $expected === $sig in a Stripe handler", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'];\n" +
          "  $expected = hash_hmac('sha256', $request->getContent(), getenv('STRIPE_WEBHOOK_SECRET'));\n" +
          "  if ($expected === $sig) { return 'ok'; }\n" +
          "  http_response_code(401);\n" +
          "});\n",
      },
      runtime,
    );
    const verdict = await stripePhpTimingUnsafeComparisonPredicate(
      makeHandler(file, "stripe"),
      makeModel(file),
    );
    expect(verdict).toBe("not-verified");
  });

  it("emits not-verified for strcmp($expected, $sig) === 0 (PHP D-09)", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'];\n" +
          "  $expected = hash_hmac('sha256', $request->getContent(), getenv('STRIPE_WEBHOOK_SECRET'));\n" +
          "  if (strcmp($expected, $sig) === 0) { return 'ok'; }\n" +
          "});\n",
      },
      runtime,
    );
    const verdict = await stripePhpTimingUnsafeComparisonPredicate(
      makeHandler(file, "stripe"),
      makeModel(file),
    );
    expect(verdict).toBe("not-verified");
  });

  it("returns null when hash_equals is used (safe form)", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/stripe', function ($request) {\n" +
          "  $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'];\n" +
          "  $expected = hash_hmac('sha256', $request->getContent(), getenv('STRIPE_WEBHOOK_SECRET'));\n" +
          "  if (hash_equals($expected, $sig)) { return 'ok'; }\n" +
          "});\n",
      },
      runtime,
    );
    const verdict = await stripePhpTimingUnsafeComparisonPredicate(
      makeHandler(file, "stripe"),
      makeModel(file),
    );
    expect(verdict).toBeNull();
  });

  it("returns null when handler.provider is not 'stripe'", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/x', function ($request) {\n" +
          "  if ($a === $b) { return 'ok'; }\n" +
          "});\n",
      },
      runtime,
    );
    const verdict = await stripePhpTimingUnsafeComparisonPredicate(
      makeHandler(file, "github"),
      makeModel(file),
    );
    expect(verdict).toBeNull();
  });
});
