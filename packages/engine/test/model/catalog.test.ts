import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { detectCatalogHandlers } from "../../src/model/catalog.js";
import { parseJsTs } from "../../src/parsers/babel.js";
import { parsePython } from "../../src/parsers/python.js";
import { initPythonRuntime, type PythonRuntime } from "../../src/parsers/python-loader.js";
import { resolvePythonWasmPath } from "../wasm.js";

let runtime: PythonRuntime;
beforeAll(async () => {
  runtime = await initPythonRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePythonWasmPath())),
  });
}, 30_000);

describe("detectCatalogHandlers — Express", () => {
  it("detects app.post('/webhooks/stripe', handler)", async () => {
    const file = await parseJsTs({
      file_path: "src/express.ts",
      source_text:
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', function stripeHandler(req, res) { res.send('ok'); });\n",
    });
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("express");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
    expect(handlers[0]?.handler_function_name).toBe("stripeHandler");
    // Issue #5 — framework_version is ALWAYS null in Phase 2.
    expect(handlers[0]?.framework_version).toBeNull();
  });

  it("ignores GET routes (webhooks are body-bearing)", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express'; const app = express(); app.get('/webhooks/x', h);",
    });
    expect(detectCatalogHandlers(file)).toHaveLength(0);
  });

  it("ignores non-webhook paths", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text: "import express from 'express'; const app = express(); app.post('/login', h);",
    });
    expect(detectCatalogHandlers(file)).toHaveLength(0);
  });
});

describe("detectCatalogHandlers — Hono and Fastify", () => {
  it("detects Hono app.post and reports framework_version: null", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import { Hono } from 'hono';\nconst app = new Hono();\napp.post('/webhooks/stripe', (c) => c.text('ok'));\n",
    });
    const handlers = detectCatalogHandlers(file);
    expect(handlers[0]?.framework).toBe("hono");
    expect(handlers[0]?.framework_version).toBeNull();
  });

  it("detects Fastify fastify.post", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import Fastify from 'fastify';\nconst f = Fastify();\nf.post('/webhooks/x', async () => 'ok');\n",
    });
    expect(detectCatalogHandlers(file)[0]?.framework).toBe("fastify");
  });

  it("detects fastify.route({ method, url, handler }) shape", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import Fastify from 'fastify';\n" +
        "const f = Fastify();\n" +
        "f.route({ method: 'POST', url: '/webhooks/x', handler: async () => 'ok' });\n",
    });
    const handlers = detectCatalogHandlers(file);
    expect(handlers[0]?.framework).toBe("fastify");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/x");
  });
});

describe("detectCatalogHandlers — Flask", () => {
  it("detects @app.route('/webhooks/stripe', methods=['POST'])", async () => {
    const file = await parsePython(
      {
        file_path: "app.py",
        source_text:
          "from flask import Flask\n" +
          "app = Flask(__name__)\n\n" +
          "@app.route('/webhooks/stripe', methods=['POST'])\n" +
          "def stripe_webhook():\n" +
          "    return 'ok'\n",
      },
      runtime,
    );
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("flask");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.http_methods).toContain("POST");
    expect(handlers[0]?.handler_function_name).toBe("stripe_webhook");
    expect(handlers[0]?.framework_version).toBeNull();
  });

  it("ignores Flask GET routes", async () => {
    const file = await parsePython(
      {
        file_path: "app.py",
        source_text:
          "from flask import Flask\napp = Flask(__name__)\n@app.route('/webhooks/health')\ndef h():\n    return 'ok'\n",
      },
      runtime,
    );
    expect(detectCatalogHandlers(file)).toHaveLength(0);
  });
});

describe("detectCatalogHandlers — parse-error short-circuit (D-27)", () => {
  it("returns empty for files with parse_error", async () => {
    const file = await parseJsTs({ file_path: "broken.ts", source_text: "const x = ;" });
    expect(file.parse_error).not.toBeNull();
    expect(detectCatalogHandlers(file)).toEqual([]);
  });
});
