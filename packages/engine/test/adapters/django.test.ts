import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { djangoAdapter } from "../../src/adapters/django.js";
import { initPythonRuntime, type PythonRuntime } from "../../src/parsers/python-loader.js";
import { parsePython } from "../../src/parsers/python.js";

let runtime: PythonRuntime;

beforeAll(async () => {
  const wasmPath = join(
    process.cwd(),
    "..",
    "..",
    "node_modules",
    ".pnpm",
    "tree-sitter-python@0.25.0",
    "node_modules",
    "tree-sitter-python",
    "tree-sitter-python.wasm",
  );
  runtime = await initPythonRuntime({ wasmBytes: new Uint8Array(readFileSync(wasmPath)) });
}, 30_000);

describe("djangoAdapter", () => {
  it("detects class-based view post() method when included in urls.py", async () => {
    const view = await parsePython(
      {
        file_path: "views.py",
        source_text:
          "from django.views import View\n" +
          "from django.http import HttpResponse\n\n" +
          "class StripeWebhook(View):\n" +
          "    def post(self, request):\n" +
          "        return HttpResponse('ok')\n",
      },
      runtime,
    );
    const urls = await parsePython(
      {
        file_path: "urls.py",
        source_text:
          "from django.urls import path\n" +
          "from views import StripeWebhook\n\n" +
          "urlpatterns = [path('webhooks/stripe', StripeWebhook.as_view())]\n",
      },
      runtime,
    );
    const handlers = djangoAdapter(view, [view, urls]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("django");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.http_methods).toContain("POST");
  });

  it("detects function-based view referenced from urls.py", async () => {
    const urls = await parsePython(
      {
        file_path: "urls.py",
        source_text:
          "from django.urls import path\n" +
          "from views import stripe_webhook\n\n" +
          "urlpatterns = [path('webhooks/stripe', stripe_webhook)]\n",
      },
      runtime,
    );
    const handlers = djangoAdapter(urls, [urls]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.handler_function_name).toBe("stripe_webhook");
  });
});
