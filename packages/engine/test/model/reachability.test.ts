import { describe, expect, it } from "vitest";
import { detectCatalogHandlers } from "../../src/model/catalog.js";
import { computeReachableSymbols } from "../../src/model/reachability.js";
import { parseJsTs } from "../../src/parsers/babel.js";

describe("computeReachableSymbols (D-34) — direct calls", () => {
  it("captures direct calls from handler body with import_source resolution", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import Stripe from 'stripe';\n" +
        "const app = express();\n" +
        "const s = new Stripe('k');\n" +
        "app.post('/webhooks/stripe', (req, res) => {\n" +
        "  s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], 'whsec_x');\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const handlers = detectCatalogHandlers(file);
    expect(handlers).toHaveLength(1);
    const reach = computeReachableSymbols({
      handler_body_node: handlers[0]?.handler_body_node,
      handler_file: file,
      all_files: [file],
      imports: file.imports,
      maxDepth: 3,
    });
    const qns = reach.map((r) => r.qualified_name);
    expect(qns).toContain("s.webhooks.constructEvent");
  });
});

describe("computeReachableSymbols (D-34) — intra-file local function expansion", () => {
  it("walks into a same-file helper function called from the handler", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import { timingSafeEqual } from 'node:crypto';\n" +
        "const app = express();\n" +
        "function verifySig(body: string, sig: string) {\n" +
        "  return timingSafeEqual(Buffer.from(body), Buffer.from(sig));\n" +
        "}\n" +
        "app.post('/webhooks/github', (req, res) => {\n" +
        "  verifySig(req.body, req.headers['x-hub-signature-256'] as string);\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const h = detectCatalogHandlers(file)[0]!;
    const reach = computeReachableSymbols({
      handler_body_node: h.handler_body_node,
      handler_file: file,
      all_files: [file],
      imports: file.imports,
      maxDepth: 3,
    });
    const qns = reach.map((r) => r.qualified_name);
    expect(qns).toContain("verifySig"); // hop 1: direct call
    expect(qns).toContain("timingSafeEqual"); // hop 2: via verifySig (intra-file expansion)
  });
});

describe("computeReachableSymbols (D-34) — cross-file import expansion", () => {
  it("walks into an imported helper from a sibling file", async () => {
    const helper = await parseJsTs({
      file_path: "src/verify.ts",
      source_text:
        "import { timingSafeEqual } from 'node:crypto';\n" +
        "export function verifyGithub(body: string, sig: string): boolean {\n" +
        "  return timingSafeEqual(Buffer.from(body), Buffer.from(sig));\n" +
        "}\n",
    });
    const handler = await parseJsTs({
      file_path: "src/handler.ts",
      source_text:
        "import express from 'express';\n" +
        "import { verifyGithub } from './verify.js';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', (req, res) => {\n" +
        "  verifyGithub(req.body, req.headers['x-hub-signature-256'] as string);\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const h = detectCatalogHandlers(handler)[0]!;
    const reach = computeReachableSymbols({
      handler_body_node: h.handler_body_node,
      handler_file: handler,
      all_files: [helper, handler],
      imports: handler.imports,
      maxDepth: 3,
    });
    const qns = reach.map((r) => r.qualified_name);
    expect(qns).toContain("verifyGithub");
    expect(qns).toContain("timingSafeEqual"); // crossed file boundary into verify.ts
  });

  it("does not exceed maxDepth", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "function a() { b(); }\n" +
        "function b() { c(); }\n" +
        "function c() { d(); }\n" +
        "function d() { e(); }\n" +
        "function e() {}\n" +
        "const app = express();\n" +
        "app.post('/webhooks/x', (req, res) => { a(); });\n",
    });
    const h = detectCatalogHandlers(file)[0]!;
    const r2 = computeReachableSymbols({
      handler_body_node: h.handler_body_node,
      handler_file: file,
      all_files: [file],
      imports: file.imports,
      maxDepth: 2,
    });
    const r4 = computeReachableSymbols({
      handler_body_node: h.handler_body_node,
      handler_file: file,
      all_files: [file],
      imports: file.imports,
      maxDepth: 4,
    });
    // r2 should reach 'a' (hop 1) and 'b' (hop 2) but NOT 'c'.
    expect(r2.map((r) => r.qualified_name)).toContain("a");
    expect(r2.map((r) => r.qualified_name)).toContain("b");
    expect(r2.map((r) => r.qualified_name)).not.toContain("c");
    // r4 should reach all of a, b, c, d.
    expect(r4.map((r) => r.qualified_name)).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
  });
});
