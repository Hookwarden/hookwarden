import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fastapiAdapter } from "../../src/adapters/fastapi.js";
import { parsePython } from "../../src/parsers/python.js";
import { initPythonRuntime, type PythonRuntime } from "../../src/parsers/python-loader.js";

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

describe("fastapiAdapter", () => {
  it("detects @router.post('/webhooks/stripe') on async def", async () => {
    const file = await parsePython(
      {
        file_path: "app.py",
        source_text:
          "from fastapi import APIRouter\n" +
          "router = APIRouter()\n\n" +
          "@router.post('/webhooks/stripe')\n" +
          "async def stripe_webhook(req):\n" +
          "    return {'ok': True}\n",
      },
      runtime,
    );
    const handlers = fastapiAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("fastapi");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
    expect(handlers[0]?.handler_function_name).toBe("stripe_webhook");
  });

  it("honors include_router prefix from a sibling file", async () => {
    const router = await parsePython(
      {
        file_path: "routes.py",
        source_text:
          "from fastapi import APIRouter\n" +
          "router = APIRouter()\n\n" +
          "@router.post('/stripe')\n" +
          "async def stripe_webhook(req):\n" +
          "    return {'ok': True}\n",
      },
      runtime,
    );
    const main = await parsePython(
      {
        file_path: "main.py",
        source_text:
          "from fastapi import FastAPI\n" +
          "from routes import router\n" +
          "app = FastAPI()\n" +
          "app.include_router(router, prefix='/webhooks')\n",
      },
      runtime,
    );
    const handlers = fastapiAdapter(router, [router, main]);
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
  });

  it("ignores non-FastAPI files", async () => {
    const file = await parsePython(
      { file_path: "x.py", source_text: "def f(x):\n    return x\n" },
      runtime,
    );
    expect(fastapiAdapter(file, [file])).toEqual([]);
  });
});
