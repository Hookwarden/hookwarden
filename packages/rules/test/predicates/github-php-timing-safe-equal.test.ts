// Phase 8.1 Plan 08 — tests for github-php-timing-safe-equal predicate.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  initPhpRuntime,
  parsePhp,
  type ParsedFile,
  type PhpRuntime,
  type ProjectModel,
  type WebhookHandler,
} from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { githubPhpTimingSafeEqualPredicate } from "../../src/predicates/github-php-timing-safe-equal.js";

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
    route_pattern: "/webhooks/github",
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

describe("githubPhpTimingSafeEqualPredicate", () => {
  it("emits not-verified for $expected === $sig in a GitHub handler", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nuse Illuminate\\Support\\Facades\\Route;\n" +
          "Route::post('/webhooks/github', function ($request) {\n" +
          "  $sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'];\n" +
          "  $expected = 'sha256=' . hash_hmac('sha256', $request->getContent(), getenv('GITHUB_WEBHOOK_SECRET'));\n" +
          "  if ($expected === $sig) { return 'ok'; }\n" +
          "  http_response_code(401);\n" +
          "});\n",
      },
      runtime,
    );
    const verdict = await githubPhpTimingSafeEqualPredicate(
      makeHandler(file, "github"),
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
          "Route::post('/webhooks/github', function ($request) {\n" +
          "  $sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'];\n" +
          "  $expected = 'sha256=' . hash_hmac('sha256', $request->getContent(), getenv('GITHUB_WEBHOOK_SECRET'));\n" +
          "  if (hash_equals($expected, $sig)) { return 'ok'; }\n" +
          "});\n",
      },
      runtime,
    );
    const verdict = await githubPhpTimingSafeEqualPredicate(
      makeHandler(file, "github"),
      makeModel(file),
    );
    expect(verdict).toBeNull();
  });

  it("returns null when handler.provider is not 'github'", async () => {
    const file = await parsePhp(
      {
        file_path: "routes/api.php",
        source_text:
          "<?php\nRoute::post('/webhooks/x', function ($request) {\n" +
          "  if ($a === $b) { return 'ok'; }\n" +
          "});\n",
      },
      runtime,
    );
    const verdict = await githubPhpTimingSafeEqualPredicate(
      makeHandler(file, "stripe"),
      makeModel(file),
    );
    expect(verdict).toBeNull();
  });
});
