import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { vanillaPhpAdapter } from "../../src/adapters/vanilla-php.js";
import { parsePhp } from "../../src/parsers/php.js";
import { initPhpRuntime, type PhpRuntime } from "../../src/parsers/php-loader.js";
import type { ParsedFile } from "../../src/types/project-model.js";
import { resolvePhpWasmPath } from "../wasm.js";

let runtime: PhpRuntime;

beforeAll(async () => {
  runtime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
}, 30_000);

async function parse(file_path: string, source_text: string): Promise<ParsedFile> {
  return await parsePhp({ file_path, source_text }, runtime);
}

describe("vanillaPhpAdapter — heuristic single-file webhook detection", () => {
  it("detects php://input + signature header + hash_hmac as a vanilla handler", async () => {
    const file = await parse(
      "webhook.php",
      "<?php\n" +
        "$body = file_get_contents('php://input');\n" +
        "$sig = $_SERVER['HTTP_STRIPE_SIGNATURE'];\n" +
        "$expected = hash_hmac('sha256', $body, $secret);\n" +
        "if (!hash_equals($expected, $sig)) http_response_code(401);\n",
    );
    const handlers = vanillaPhpAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("vanilla-php");
    expect(handlers[0]?.route_pattern).toBe("/webhook");
    // No REQUEST_METHOD guard → default POST.
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
  });

  it("extracts http_methods from a REQUEST_METHOD === 'POST' guard", async () => {
    const file = await parse(
      "webhook.php",
      "<?php\n" +
        "if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }\n" +
        "$body = file_get_contents('php://input');\n",
    );
    const handlers = vanillaPhpAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
  });

  it("extracts http_methods from an in_array(REQUEST_METHOD, ['POST', 'PUT']) guard", async () => {
    const file = await parse(
      "webhook.php",
      "<?php\n" +
        "if (!in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT'])) { exit; }\n" +
        "$body = file_get_contents('php://input');\n",
    );
    const handlers = vanillaPhpAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.http_methods).toEqual(["POST", "PUT"]);
  });

  it("rejects a file importing Laravel namespaces (Illuminate\\)", async () => {
    const file = await parse(
      "webhook.php",
      "<?php\n" +
        "use Illuminate\\Support\\Facades\\Route;\n" +
        "$body = file_get_contents('php://input');\n",
    );
    expect(vanillaPhpAdapter(file, [file])).toEqual([]);
  });

  it("rejects a file importing Symfony namespaces", async () => {
    const file = await parse(
      "webhook.php",
      "<?php\n" +
        "use Symfony\\Component\\Routing\\Attribute\\Route;\n" +
        "$body = file_get_contents('php://input');\n",
    );
    expect(vanillaPhpAdapter(file, [file])).toEqual([]);
  });

  it("rejects a file importing Slim namespaces", async () => {
    const file = await parse(
      "webhook.php",
      "<?php\n" +
        "use Slim\\Factory\\AppFactory;\n" +
        "$body = file_get_contents('php://input');\n",
    );
    expect(vanillaPhpAdapter(file, [file])).toEqual([]);
  });

  it("rejects a file with no framework imports AND no vanilla signals", async () => {
    const file = await parse(
      "helpers.php",
      "<?php\n" + "function format($x) { return strtoupper($x); }\n" + "echo format('hello');\n",
    );
    expect(vanillaPhpAdapter(file, [file])).toEqual([]);
  });

  it("derives route_pattern from basename — stripe-webhook.php → /stripe-webhook", async () => {
    const file = await parse(
      "stripe-webhook.php",
      "<?php\n$body = file_get_contents('php://input');\n",
    );
    const handlers = vanillaPhpAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.route_pattern).toBe("/stripe-webhook");
  });

  it("derives route_pattern from basename for nested paths — webhooks/stripe.php → /stripe", async () => {
    const file = await parse(
      "webhooks/stripe.php",
      "<?php\n$sig = $_SERVER['HTTP_STRIPE_SIGNATURE'];\n",
    );
    const handlers = vanillaPhpAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.route_pattern).toBe("/stripe");
  });

  it("detects via getallheaders() signal alone", async () => {
    const file = await parse(
      "webhook.php",
      "<?php\n" +
        "$headers = getallheaders();\n" +
        "$sig = $headers['X-Webhook-Signature'] ?? '';\n",
    );
    const handlers = vanillaPhpAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("vanilla-php");
  });
});
