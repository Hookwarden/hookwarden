// Synthetic fixture generator. Emits ~50K LOC across the 7 supported frameworks + a parse-error
// file + a verified-via-SDK file. Generator is idempotent — re-running overwrites the tree.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "generated");

interface FixtureFile {
  readonly relPath: string;
  readonly framework: string;
  readonly language: "javascript" | "typescript" | "python" | "php";
  readonly expected_handlers: number;
  readonly parse_error_expected: boolean;
  readonly contents: string;
}

const FILES: FixtureFile[] = [];

// Express (TS) — 100 modules × ~150 lines each = ~15K LOC.
for (let i = 0; i < 100; i++) {
  FILES.push({
    relPath: `express-app/handlers/handler-${i}.ts`,
    framework: "express",
    language: "typescript",
    expected_handlers: 1,
    parse_error_expected: false,
    contents: expressHandler(i),
  });
}

// Hono (TS) — 60 modules × ~120 lines = ~7.2K LOC.
for (let i = 0; i < 60; i++) {
  FILES.push({
    relPath: `hono-app/handlers/handler-${i}.ts`,
    framework: "hono",
    language: "typescript",
    expected_handlers: 1,
    parse_error_expected: false,
    contents: honoHandler(i),
  });
}

// Fastify (TS) — 40 modules × ~120 lines = ~4.8K LOC.
for (let i = 0; i < 40; i++) {
  FILES.push({
    relPath: `fastify-app/handlers/handler-${i}.ts`,
    framework: "fastify",
    language: "typescript",
    expected_handlers: 1,
    parse_error_expected: false,
    contents: fastifyHandler(i),
  });
}

// Next.js — 20 routes × ~80 lines = ~1.6K LOC.
for (let i = 0; i < 20; i++) {
  FILES.push({
    relPath: `nextjs-app/app/api/webhooks/svc-${i}/route.ts`,
    framework: "nextjs",
    language: "typescript",
    expected_handlers: 1,
    parse_error_expected: false,
    contents: nextjsRoute(i),
  });
}

// Flask (Python) — 80 modules × ~100 lines = ~8K LOC.
for (let i = 0; i < 80; i++) {
  FILES.push({
    relPath: `flask-app/views/view_${i}.py`,
    framework: "flask",
    language: "python",
    expected_handlers: 1,
    parse_error_expected: false,
    contents: flaskHandler(i),
  });
}

// FastAPI (Python) — 50 modules × ~120 lines + main.py with include_router calls.
for (let i = 0; i < 50; i++) {
  FILES.push({
    relPath: `fastapi-app/routers/router_${i}.py`,
    framework: "fastapi",
    language: "python",
    expected_handlers: 1,
    parse_error_expected: false,
    contents: fastapiRouter(i),
  });
}
FILES.push({
  relPath: "fastapi-app/main.py",
  framework: "fastapi",
  language: "python",
  expected_handlers: 0,
  parse_error_expected: false,
  contents: fastapiMain(50),
});

// Django (Python) — 30 view modules + 1 urls.py × ~120 lines = ~3.7K LOC.
for (let i = 0; i < 30; i++) {
  FILES.push({
    relPath: `django-app/views/view_${i}.py`,
    framework: "django",
    language: "python",
    expected_handlers: 1,
    parse_error_expected: false,
    contents: djangoView(i),
  });
}
FILES.push({
  relPath: "django-app/urls.py",
  framework: "django",
  language: "python",
  expected_handlers: 0,
  parse_error_expected: false,
  contents: djangoUrls(30),
});

// One verified-via-SDK file (ensures at least one Finding ends up `verified`).
FILES.push({
  relPath: "express-app/handlers/verified-github.ts",
  framework: "express",
  language: "typescript",
  expected_handlers: 1,
  parse_error_expected: false,
  contents:
    "import express from 'express';\n" +
    "import { verify } from '@octokit/webhooks-methods';\n" +
    "const app = express();\n" +
    "app.post('/webhooks/github', async (req, res) => {\n" +
    "  await verify(process.env.SECRET ?? '', req.body, req.headers['x-hub-signature-256'] as string);\n" +
    "  res.send('ok');\n" +
    "});\n",
});

// Phase 8.1 — PHP synthetic corpus (~10K LOC). Mix of frameworks (Laravel / Symfony / Slim /
// vanilla-PHP) across the 6 v1 providers. Webhook handler shapes cycle through verified +
// not-verified patterns so the engine exercises both branches of the catalog walker + rule
// evaluator.
const PHP_PROVIDERS = ["stripe", "github", "shopify", "slack", "twilio", "square"] as const;
type PhpProvider = (typeof PHP_PROVIDERS)[number];

const PHP_PROVIDER_META: Record<
  PhpProvider,
  {
    readonly header: string; // SignatureHeader name in $_SERVER form (HTTP_*)
    readonly envVar: string; // canonical env var name
    readonly algo: string; // hash_hmac algo
  }
> = {
  stripe: { header: "HTTP_STRIPE_SIGNATURE", envVar: "STRIPE_WEBHOOK_SECRET", algo: "sha256" },
  github: { header: "HTTP_X_HUB_SIGNATURE_256", envVar: "GITHUB_WEBHOOK_SECRET", algo: "sha256" },
  shopify: {
    header: "HTTP_X_SHOPIFY_HMAC_SHA256",
    envVar: "SHOPIFY_WEBHOOK_SECRET",
    algo: "sha256",
  },
  slack: { header: "HTTP_X_SLACK_SIGNATURE", envVar: "SLACK_SIGNING_SECRET", algo: "sha256" },
  twilio: { header: "HTTP_X_TWILIO_SIGNATURE", envVar: "TWILIO_AUTH_TOKEN", algo: "sha1" },
  square: {
    header: "HTTP_X_SQUARE_HMACSHA256_SIGNATURE",
    envVar: "SQUARE_WEBHOOK_SECRET",
    algo: "sha256",
  },
};

// Laravel route + controller pairs (route file declares the route; controller has the handler).
for (let i = 0; i < 90; i++) {
  const provider = PHP_PROVIDERS[i % PHP_PROVIDERS.length] as PhpProvider;
  FILES.push({
    relPath: `php/laravel-${provider}/routes/api-${i}.php`,
    framework: "laravel",
    language: "php" as const,
    expected_handlers: 1,
    parse_error_expected: false,
    contents: laravelRouteFile(provider, i),
  });
  FILES.push({
    relPath: `php/laravel-${provider}/app/Http/Controllers/WebhookController${i}.php`,
    framework: "laravel",
    language: "php" as const,
    expected_handlers: 0, // controller-only file — route file owns the handler
    parse_error_expected: false,
    contents: laravelController(provider, i),
  });
}

// Symfony attribute-routed controllers.
for (let i = 0; i < 90; i++) {
  const provider = PHP_PROVIDERS[i % PHP_PROVIDERS.length] as PhpProvider;
  FILES.push({
    relPath: `php/symfony-${provider}/src/Controller/WebhookController${i}.php`,
    framework: "symfony",
    language: "php" as const,
    expected_handlers: 1,
    parse_error_expected: false,
    contents: symfonyController(provider, i),
  });
}

// Slim app definitions.
for (let i = 0; i < 90; i++) {
  const provider = PHP_PROVIDERS[i % PHP_PROVIDERS.length] as PhpProvider;
  FILES.push({
    relPath: `php/slim-${provider}/public/index-${i}.php`,
    framework: "slim",
    language: "php" as const,
    expected_handlers: 1,
    parse_error_expected: false,
    contents: slimHandler(provider, i),
  });
}

// vanilla-PHP single-file handlers.
for (let i = 0; i < 180; i++) {
  const provider = PHP_PROVIDERS[i % PHP_PROVIDERS.length] as PhpProvider;
  FILES.push({
    relPath: `php/vanilla-${provider}/webhook-${i}.php`,
    framework: "vanilla-php",
    language: "php" as const,
    expected_handlers: 1,
    parse_error_expected: false,
    contents: vanillaPhpHandler(provider, i),
  });
}

// One verified-via-SDK PHP file (ensures at least one PHP Finding ends up `verified`).
FILES.push({
  relPath: "php/laravel-stripe/routes/api-verified.php",
  framework: "laravel",
  language: "php" as const,
  expected_handlers: 1,
  parse_error_expected: false,
  contents:
    "<?php\n" +
    "use Illuminate\\Support\\Facades\\Route;\n" +
    "use Stripe\\Webhook;\n" +
    "Route::post('/webhooks/stripe', function ($request) {\n" +
    "  $sig = $_SERVER['HTTP_STRIPE_SIGNATURE'];\n" +
    "  $secret = getenv('STRIPE_WEBHOOK_SECRET');\n" +
    "  $event = \\Stripe\\Webhook::constructEvent($request->getContent(), $sig, $secret);\n" +
    "  return response()->json(['received' => true]);\n" +
    "});\n",
});

// One parse-error file (ENGINE-07 coverage).
FILES.push({
  relPath: "express-app/broken.ts",
  framework: "express",
  language: "typescript",
  expected_handlers: 0,
  parse_error_expected: true,
  contents: "const x = ;\nconst y = 1;\n",
});

function expressHandler(i: number): string {
  return [
    "import express from 'express';",
    "const app = express();",
    `app.post('/webhooks/svc${i}', (req, res) => {`,
    "  res.send('ok');",
    "});",
    padding("// noop", 145),
  ].join("\n");
}

function honoHandler(i: number): string {
  return [
    "import { Hono } from 'hono';",
    "const app = new Hono();",
    `app.post('/webhooks/svc${i}', (c) => c.text('ok'));`,
    padding("// noop", 117),
  ].join("\n");
}

function fastifyHandler(i: number): string {
  return [
    "import Fastify from 'fastify';",
    "const f = Fastify();",
    `f.post('/webhooks/svc${i}', async () => 'ok');`,
    padding("// noop", 117),
  ].join("\n");
}

function nextjsRoute(i: number): string {
  return [
    `// Next.js webhook route svc-${i}`,
    "export async function POST(req: Request) {",
    "  const body = await req.text();",
    "  return new Response('ok');",
    "}",
    padding("// noop", 75),
  ].join("\n");
}

function flaskHandler(i: number): string {
  return [
    "from flask import Flask",
    "app = Flask(__name__)",
    "",
    `@app.route('/webhooks/svc${i}', methods=['POST'])`,
    `def handler_${i}():`,
    "    return 'ok'",
    padding("# noop", 94),
  ].join("\n");
}

function fastapiRouter(i: number): string {
  // Each router file uses a unique variable name (`router_${i}`) — and main.py imports it
  // directly without aliasing — so the adapter's collectIncludeRouterPrefixes sees the same
  // identifier in both files. With `router as router_${i}` aliased imports, the adapter
  // would see `@router.post(...)` locally but `app.include_router(router_${i}, ...)` in
  // main, and the variable-name mismatch silently hides the prefix (issue #8 caught this).
  return [
    "from fastapi import APIRouter",
    `router_${i} = APIRouter()`,
    "",
    `@router_${i}.post('/svc${i}')`,
    `async def handler_${i}(req):`,
    "    return {'ok': True}",
    padding("# noop", 114),
  ].join("\n");
}

function fastapiMain(routerCount: number): string {
  const lines: string[] = ["from fastapi import FastAPI", "app = FastAPI()"];
  for (let i = 0; i < routerCount; i++) {
    lines.push(`from routers.router_${i} import router_${i}`);
    lines.push(`app.include_router(router_${i}, prefix='/webhooks')`);
  }
  return lines.join("\n");
}

function djangoView(i: number): string {
  return [
    "from django.views import View",
    "from django.http import HttpResponse",
    "",
    `class WebhookView${i}(View):`,
    "    def post(self, request):",
    "        return HttpResponse('ok')",
    padding("# noop", 114),
  ].join("\n");
}

function djangoUrls(viewCount: number): string {
  const lines: string[] = ["from django.urls import path"];
  for (let i = 0; i < viewCount; i++) {
    lines.push(`from views.view_${i} import WebhookView${i}`);
  }
  lines.push("urlpatterns = [");
  for (let i = 0; i < viewCount; i++) {
    lines.push(`    path('webhooks/svc${i}', WebhookView${i}.as_view()),`);
  }
  lines.push("]");
  return lines.join("\n");
}

function padding(commentLine: string, n: number): string {
  return Array.from({ length: n }, () => commentLine).join("\n");
}

// ===== PHP templates (Phase 8.1) =====

function laravelRouteFile(provider: PhpProvider, i: number): string {
  const meta = PHP_PROVIDER_META[provider];
  // Even-indexed: not-verified shape (manual hash_hmac + ===). Odd: not-verified shape (no
  // verification). Verified-via-SDK shape lives in the one explicit file declared above.
  const unsafeCompare = i % 2 === 0;
  return [
    "<?php",
    "use Illuminate\\Support\\Facades\\Route;",
    `Route::post('/webhooks/${provider}-${i}', function (\\Illuminate\\Http\\Request $request) {`,
    `  $sig = $_SERVER['${meta.header}'] ?? '';`,
    `  $secret = getenv('${meta.envVar}');`,
    unsafeCompare
      ? `  $expected = hash_hmac('${meta.algo}', $request->getContent(), $secret);\n  if ($expected === $sig) { return response('ok'); }\n  return response('forbidden', 403);`
      : `  return response('ok');`,
    "});",
    padding("// noop padding for perf-corpus density", 100),
  ].join("\n");
}

function laravelController(provider: PhpProvider, i: number): string {
  return [
    "<?php",
    "namespace App\\Http\\Controllers;",
    "use Illuminate\\Http\\Request;",
    `class WebhookController${i} extends Controller {`,
    `  public function handle${i}(Request $request) {`,
    `    return response()->json(['provider' => '${provider}']);`,
    "  }",
    "}",
    padding("// noop", 60),
  ].join("\n");
}

function symfonyController(provider: PhpProvider, i: number): string {
  const meta = PHP_PROVIDER_META[provider];
  const unsafeCompare = i % 2 === 0;
  return [
    "<?php",
    "namespace App\\Controller;",
    "use Symfony\\Component\\Routing\\Attribute\\Route;",
    "use Symfony\\Component\\HttpFoundation\\Request;",
    "use Symfony\\Component\\HttpFoundation\\JsonResponse;",
    `class WebhookController${i} {`,
    `  #[Route('/webhooks/${provider}-${i}', methods: ['POST'])]`,
    `  public function handle(Request $request): JsonResponse {`,
    `    $sig = $_SERVER['${meta.header}'] ?? '';`,
    `    $secret = getenv('${meta.envVar}');`,
    unsafeCompare
      ? `    $expected = hash_hmac('${meta.algo}', $request->getContent(), $secret);\n    if ($expected === $sig) { return new JsonResponse(['ok' => true]); }\n    return new JsonResponse(['error' => 'forbidden'], 403);`
      : `    return new JsonResponse(['ok' => true]);`,
    "  }",
    "}",
    padding("// noop", 50),
  ].join("\n");
}

function slimHandler(provider: PhpProvider, i: number): string {
  const meta = PHP_PROVIDER_META[provider];
  return [
    "<?php",
    "use Slim\\Factory\\AppFactory;",
    "use Psr\\Http\\Message\\ServerRequestInterface;",
    "use Psr\\Http\\Message\\ResponseInterface;",
    "$app = AppFactory::create();",
    `$app->post('/webhooks/${provider}-${i}', function (ServerRequestInterface $req, ResponseInterface $res) {`,
    `  $sig = $_SERVER['${meta.header}'] ?? '';`,
    `  $secret = getenv('${meta.envVar}');`,
    `  $body = (string) $req->getBody();`,
    `  $expected = hash_hmac('${meta.algo}', $body, $secret);`,
    "  if (hash_equals($expected, $sig)) {",
    "    $res->getBody()->write('ok');",
    "  }",
    "  return $res;",
    "});",
    "$app->run();",
    padding("// noop", 50),
  ].join("\n");
}

function vanillaPhpHandler(provider: PhpProvider, i: number): string {
  const meta = PHP_PROVIDER_META[provider];
  const unsafeCompare = i % 3 === 0;
  return [
    "<?php",
    "// Vanilla PHP webhook handler (no framework).",
    `if ($_SERVER['REQUEST_METHOD'] !== 'POST') {`,
    "  http_response_code(405);",
    "  exit;",
    "}",
    `$body = file_get_contents('php://input');`,
    `$sig = $_SERVER['${meta.header}'] ?? '';`,
    `$secret = getenv('${meta.envVar}');`,
    `$expected = hash_hmac('${meta.algo}', $body, $secret);`,
    unsafeCompare
      ? "if ($expected === $sig) { echo 'ok'; } else { http_response_code(403); }"
      : "if (hash_equals($expected, $sig)) { echo 'ok'; } else { http_response_code(403); }",
    padding("// noop", 70),
  ].join("\n");
}

export async function generate(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  let totalLines = 0;
  for (const f of FILES) {
    const dest = join(OUT, f.relPath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.contents, "utf8");
    totalLines += f.contents.split("\n").length;
  }
  const manifest = {
    total_files: FILES.length,
    total_lines: totalLines,
    files: FILES.map(
      ({ relPath, framework, language, expected_handlers, parse_error_expected }) => ({
        relPath,
        framework,
        language,
        expected_handlers,
        parse_error_expected,
      }),
    ),
  };
  writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void generate();
}
