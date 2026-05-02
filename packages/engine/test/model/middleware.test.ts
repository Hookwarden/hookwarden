import { describe, expect, it } from "vitest";
import { detectCatalogHandlers } from "../../src/model/catalog.js";
import { extractMiddlewareChain } from "../../src/model/middleware.js";
import { parseJsTs } from "../../src/parsers/babel.js";

describe("extractMiddlewareChain (D-36 middleware_chain) — Express", () => {
  it("captures app.use(...) registrations before the route", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import cors from 'cors';\n" +
        "const app = express();\n" +
        "app.use(express.json());\n" +
        "app.use(cors());\n" +
        "app.post('/webhooks/stripe', (req, res) => res.send('ok'));\n",
    });
    const h = detectCatalogHandlers(file)[0]!;
    const chain = extractMiddlewareChain({ handler: h, parsedFile: file, imports: file.imports });
    const names = chain.map((m) => m.name);
    expect(names).toContain("express.json");
    expect(names).toContain("cors");
    // Positions are zero-indexed and sequential.
    expect(chain.map((m) => m.position)).toEqual(chain.map((_, i) => i));
  });

  it("captures per-route middleware args (app.post('/x', mw1, mw2, handler))", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "import auth from 'auth-mw';\n" +
        "import rate from 'rate-limit';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/stripe', auth, rate, (req, res) => res.send('ok'));\n",
    });
    const h = detectCatalogHandlers(file)[0]!;
    const chain = extractMiddlewareChain({ handler: h, parsedFile: file, imports: file.imports });
    const names = chain.map((m) => m.name);
    expect(names).toEqual(["auth", "rate"]);
    expect(chain[0]?.import_source).toBe("auth-mw");
    expect(chain[1]?.import_source).toBe("rate-limit");
  });

  it("returns [] for Flask handlers (decorator-based middleware deferred per v1 note)", async () => {
    const file = await parseJsTs({
      file_path: "x.ts",
      source_text:
        "import express from 'express';\n" +
        "const app = express();\n" +
        "app.post('/webhooks/x', (req, res) => res.send('ok'));\n",
    });
    const h = detectCatalogHandlers(file)[0]!;
    const flaskHandler = { ...h, framework: "flask" as const };
    const chain = extractMiddlewareChain({
      handler: flaskHandler,
      parsedFile: file,
      imports: file.imports,
    });
    expect(chain).toEqual([]);
  });
});
