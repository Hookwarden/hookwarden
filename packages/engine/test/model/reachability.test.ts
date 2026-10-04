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

describe("computeReachableSymbols (D-34) — HMAC algorithm literal capture (RULES-02)", () => {
  // Regression: Node's `crypto.createHmac('sha256', …)` passes the digest algorithm as a
  // string literal, so it never appeared as a symbol — wrong-hmac-algorithm then mis-fired
  // "algorithm undetermined" on every manual-HMAC JS handler. The algorithm must surface as a
  // `crypto.<algo>` symbol so the rule can confirm SHA-256 (no finding) yet still catch MD5.
  it("surfaces createHmac's string-literal algorithm as a crypto.<algo> symbol", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import crypto from 'node:crypto';\n" +
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', (req, res) => {\n" +
        "  const mac = crypto.createHmac('sha256', process.env.SECRET).update(req.body).digest('hex');\n" +
        "  res.send(mac);\n" +
        "});\n",
    });
    const h = detectCatalogHandlers(file)[0]!;
    const qns = computeReachableSymbols({
      handler_body_node: h.handler_body_node,
      handler_file: file,
      all_files: [file],
      imports: file.imports,
      maxDepth: 3,
    }).map((r) => r.qualified_name);
    expect(qns).toContain("crypto.createHmac");
    expect(qns).toContain("crypto.sha256");
  });

  it("normalizes the algorithm literal ('SHA-256' → crypto.sha256)", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import crypto from 'node:crypto';\n" +
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/github', (req, res) => {\n" +
        "  crypto.createHmac('SHA-256', 's').update(req.body).digest('hex');\n" +
        "  res.send('ok');\n" +
        "});\n",
    });
    const h = detectCatalogHandlers(file)[0]!;
    const qns = computeReachableSymbols({
      handler_body_node: h.handler_body_node,
      handler_file: file,
      all_files: [file],
      imports: file.imports,
      maxDepth: 3,
    }).map((r) => r.qualified_name);
    expect(qns).toContain("crypto.sha256");
  });
});

describe("computeReachableSymbols (D-34) — multi-hop cross-file chain (n8n trigger shape)", () => {
  // node → sibling helper (aliased re-import) → shared util two dirs up → local fn.
  // Mirrors n8n's *Trigger.node.ts → *TriggerHelpers.ts → utils/webhook-signature-verification.ts.
  it("resolves ../../ paths, aliased imports in intermediate files, and picks the exact file", async () => {
    const decoy = await parseJsTs({
      file_path: "decoy/utils/webhook-signature-verification.ts",
      source_text: "export function verifySignature() { return true; }\n",
    });
    const util = await parseJsTs({
      file_path: "pkg/utils/webhook-signature-verification.ts",
      source_text:
        "import { timingSafeEqual } from 'crypto';\n" +
        "export function verifySignature(o: any): boolean {\n" +
        "  if (!isTimestampValid(o.ts)) return false;\n" +
        "  return timingSafeEqual(Buffer.from(o.a), Buffer.from(o.b));\n" +
        "}\n" +
        "function isTimestampValid(ts: number): boolean {\n" +
        "  return Math.abs(Date.now() / 1000 - ts) <= 300;\n" +
        "}\n",
    });
    const helper = await parseJsTs({
      file_path: "pkg/nodes/Foo/FooTriggerHelpers.ts",
      source_text:
        "import { createHmac } from 'crypto';\n" +
        "import { verifySignature as verifySignatureGeneric } from '../../utils/webhook-signature-verification';\n" +
        "export function verifySignature(this: any): boolean {\n" +
        "  return verifySignatureGeneric({ a: createHmac('sha256', 'k').digest('hex'), b: '' });\n" +
        "}\n",
    });
    const handler = await parseJsTs({
      file_path: "pkg/nodes/Foo/FooTrigger.node.ts",
      source_text:
        "import { verifySignature } from './FooTriggerHelpers';\n" +
        "export async function webhook(this: any) {\n" +
        "  if (!verifySignature.call(this)) return {};\n" +
        "  return { workflowData: [] };\n" +
        "}\n",
    });
    const body = (handler.raw_ast as { program: { body: unknown[] } }).program.body[1];
    const reach = computeReachableSymbols({
      handler_body_node: body,
      handler_file: handler,
      all_files: [decoy, util, helper, handler],
      imports: handler.imports,
      maxDepth: 4,
    });
    const qns = reach.map((r) => r.qualified_name);
    expect(qns).toContain("verifySignatureGeneric"); // hop 2: helper body
    expect(qns).toContain("timingSafeEqual"); // hop 3: util body via aliased import + ../../
    expect(qns).toContain("Date.now"); // hop 4: util-local isTimestampValid
  });
});
