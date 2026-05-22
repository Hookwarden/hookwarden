import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { detectCatalogHandlers } from "../../src/model/catalog.js";
import { parsePhp } from "../../src/parsers/php.js";
import { initPhpRuntime, type PhpRuntime } from "../../src/parsers/php-loader.js";
import { resolvePhpWasmPath } from "../wasm.js";

let runtime: PhpRuntime;
beforeAll(async () => {
  runtime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
}, 30_000);

async function parse(file_path: string, source_text: string) {
  return await parsePhp({ file_path, source_text }, runtime);
}

describe("detectCatalogHandlers — Laravel (Phase 8.1 Plan 05)", () => {
  it("detects Route::post with array handler [Controller::class, 'method']", async () => {
    const file = await parse(
      "routes/api.php",
      "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
        "Route::post('/webhooks/stripe', [StripeWebhookController::class, 'handle']);\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("laravel");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
    expect(handlers[0]?.handler_function_name).toBe("handle");
    expect(handlers[0]?.framework_version).toBeNull();
  });

  it("detects Route::post with arrow-function closure handler", async () => {
    const file = await parse(
      "routes/web.php",
      "<?php\nRoute::post('/webhooks/github', fn ($request) => 'ok');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("laravel");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/github");
    // closure handler — anonymous, no name extractable
    expect(handlers[0]?.handler_function_name).toBeNull();
  });

  it("detects Route::post in routes/web.php convention even without facade import", async () => {
    const file = await parse(
      "routes/web.php",
      "<?php\nRoute::post('/webhooks/shopify', 'WebhookController@shopify');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("laravel");
    // 'WebhookController@shopify' → method name after @
    expect(handlers[0]?.handler_function_name).toBe("shopify");
  });

  it("ignores Route::post in a file outside routes/*.php with no Illuminate import", async () => {
    const file = await parse(
      "src/some-file.php",
      "<?php\nRoute::post('/webhooks/stripe', fn ($r) => 'ok');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(0);
  });

  it("dispatches HTTP verb from method name (Route::get vs Route::post)", async () => {
    const file = await parse(
      "routes/api.php",
      "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
        "Route::get('/webhooks/stripe', fn () => 'ok');\n" +
        "Route::post('/webhooks/stripe', fn () => 'ok');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(2);
    const methods = handlers.map((h) => h.http_methods[0]).sort();
    expect(methods).toEqual(["GET", "POST"]);
  });
});

describe("detectCatalogHandlers — Slim (Phase 8.1 Plan 05)", () => {
  it("detects $app->post with arrow-function handler and AppFactory import", async () => {
    const file = await parse(
      "src/slim-app.php",
      "<?php\nuse Slim\\Factory\\AppFactory;\n" +
        "$app = AppFactory::create();\n" +
        "$app->post('/webhooks/stripe', fn ($req, $res) => $res);\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("slim");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
  });

  it("detects $app->post with new Slim\\App import + class-name handler string", async () => {
    const file = await parse(
      "src/slim-bootstrap.php",
      "<?php\nuse Slim\\App;\n$app = new App();\n" +
        "$app->post('/webhooks/github', 'GithubWebhookController');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("slim");
  });

  it("ignores $app->post in a file with no Slim\\ import (rejects ambiguous $app)", async () => {
    const file = await parse(
      "src/random.php",
      "<?php\n$app->post('/webhooks/stripe', fn () => 'ok');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(0);
  });

  it("dispatches Slim HTTP verb correctly ($app->get vs $app->post)", async () => {
    const file = await parse(
      "src/slim.php",
      "<?php\nuse Slim\\App;\n" +
        "$app->get('/webhooks/stripe', fn () => 'ok');\n" +
        "$app->post('/webhooks/stripe', fn () => 'ok');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(2);
  });
});

describe("detectCatalogHandlers — cross-framework gating (mutually exclusive)", () => {
  it("a Laravel file does NOT also emit Slim candidates", async () => {
    const file = await parse(
      "routes/api.php",
      "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
        "Route::post('/webhooks/x', fn () => 'ok');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers.every((h) => h.framework === "laravel")).toBe(true);
  });

  it("a Slim file does NOT also emit Laravel candidates", async () => {
    const file = await parse(
      "src/slim.php",
      "<?php\nuse Slim\\Factory\\AppFactory;\n$app = AppFactory::create();\n" +
        "$app->post('/webhooks/x', fn () => 'ok');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers.every((h) => h.framework === "slim")).toBe(true);
  });

  it("non-webhook routes are filtered out (isWebhookishPath gate)", async () => {
    const file = await parse(
      "routes/api.php",
      "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
        "Route::post('/users', fn () => 'ok');\n" +
        "Route::post('/webhooks/stripe', fn () => 'ok');\n",
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
  });
});
