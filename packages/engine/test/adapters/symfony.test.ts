import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { symfonyAdapter } from "../../src/adapters/symfony.js";
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

describe("symfonyAdapter — PHP attribute routing", () => {
  it("detects #[Route(path, methods: ['POST'])] on a controller method", async () => {
    const file = await parse(
      "src/Controller/StripeController.php",
      "<?php\n" +
        "namespace App\\Controller;\n" +
        "use Symfony\\Component\\Routing\\Attribute\\Route;\n" +
        "class StripeController {\n" +
        "  #[Route('/webhooks/stripe', methods: ['POST'])]\n" +
        "  public function handle() { return 'ok'; }\n" +
        "}\n",
    );
    const handlers = symfonyAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("symfony");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
    expect(handlers[0]?.handler_function_name).toBe("StripeController::handle");
    expect(handlers[0]?.framework_version).toBeNull();
  });

  it("defaults http_methods to Symfony's permissive set when methods: arg is omitted", async () => {
    const file = await parse(
      "src/Controller/WebhookController.php",
      "<?php\n" +
        "use Symfony\\Component\\Routing\\Attribute\\Route;\n" +
        "class WebhookController {\n" +
        "  #[Route('/webhooks/stripe')]\n" +
        "  public function handle() { return 'ok'; }\n" +
        "}\n",
    );
    const handlers = symfonyAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    // Symfony's default when methods is omitted: all verbs permitted. POST must be present
    // because the rule pack keys on body-bearing methods.
    expect(handlers[0]?.http_methods).toContain("POST");
    expect(handlers[0]?.http_methods).toContain("GET");
  });

  it("detects a controller in src/Controller/ without an explicit `use Symfony\\...` import", async () => {
    const file = await parse(
      "src/Controller/WebhookController.php",
      "<?php\n" +
        "namespace App\\Controller;\n" +
        "class WebhookController {\n" +
        "  #[Route('/webhooks/github', methods: ['POST'])]\n" +
        "  public function handle() { return 'ok'; }\n" +
        "}\n",
    );
    const handlers = symfonyAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.route_pattern).toBe("/webhooks/github");
  });

  it("returns zero candidates for a non-Symfony PHP file outside src/Controller/", async () => {
    const file = await parse(
      "lib/Helpers.php",
      "<?php\n" + "class Helpers {\n" + "  public function format() { return 'ok'; }\n" + "}\n",
    );
    const handlers = symfonyAdapter(file, [file]);
    expect(handlers).toEqual([]);
  });

  it("captures multi-method arrays like methods: ['POST', 'PUT']", async () => {
    const file = await parse(
      "src/Controller/Webhook.php",
      "<?php\n" +
        "use Symfony\\Component\\Routing\\Attribute\\Route;\n" +
        "class Webhook {\n" +
        "  #[Route('/webhooks/x', methods: ['POST', 'PUT'])]\n" +
        "  public function handle() { return 'ok'; }\n" +
        "}\n",
    );
    const handlers = symfonyAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.http_methods).toEqual(["POST", "PUT"]);
  });

  it("rejects a vanilla PHP file with no Symfony imports and not under src/Controller/", async () => {
    const file = await parse(
      "webhook.php",
      "<?php\n$body = file_get_contents('php://input');\necho $body;\n",
    );
    const handlers = symfonyAdapter(file, [file]);
    expect(handlers).toEqual([]);
  });

  it("returns nothing on a parse-error file (D-27 all-or-nothing)", async () => {
    // Construct an artificially broken ParsedFile to verify the parse-error guard.
    const broken: ParsedFile = {
      file_path: "src/Controller/Bad.php",
      language: "php",
      dialect: "tree-sitter-php",
      source_text: "<?php class { bad",
      raw_ast: null,
      imports: [],
      parse_error: {
        message: "synthetic parse error",
        location: { line: 1, col: 1 },
        source: "tree-sitter",
      },
    };
    expect(symfonyAdapter(broken, [broken])).toEqual([]);
  });
});
