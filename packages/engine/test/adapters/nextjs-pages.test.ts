import { describe, expect, it } from "vitest";
import { nextjsPagesAdapter } from "../../src/adapters/nextjs-pages.js";
import { parseJsTs } from "../../src/parsers/babel.js";

async function handlersFor(file_path: string, source_text: string) {
  const file = await parseJsTs({ file_path, source_text });
  return nextjsPagesAdapter(file, [file]);
}

describe("nextjsPagesAdapter", () => {
  it("detects `export default function handler(req,res)` in pages/api", async () => {
    const h = await handlersFor(
      "pages/api/stripe/webhook.ts",
      "export default function handler(req, res) {\n  if (req.method === 'POST') { res.json({ ok: true }); }\n}\n",
    );
    expect(h).toHaveLength(1);
    expect(h[0]?.framework).toBe("nextjs");
    expect(h[0]?.route_pattern).toBe("/api/stripe/webhook");
    expect(h[0]?.http_methods).toEqual(["POST"]);
    expect(h[0]?.handler_body_node).toBeDefined();
  });

  it("detects `export default async (req,res) => {}` arrow form", async () => {
    const h = await handlersFor(
      "pages/api/hook.ts",
      "export default async (req, res) => { res.end(); };\n",
    );
    expect(h).toHaveLength(1);
    expect(h[0]?.route_pattern).toBe("/api/hook");
    // no method guard → defaults to POST
    expect(h[0]?.http_methods).toEqual(["POST"]);
  });

  it("resolves `const handler = ...; export default handler;`", async () => {
    const h = await handlersFor(
      "pages/api/webhooks/stripe.ts",
      "const handler = async (req, res) => { res.end(); };\nexport default handler;\n",
    );
    expect(h).toHaveLength(1);
    expect(h[0]?.route_pattern).toBe("/api/webhooks/stripe");
  });

  it("resolves `export { handler as default }`", async () => {
    const h = await handlersFor(
      "pages/api/x.ts",
      "function handler(req, res) { res.end(); }\nexport { handler as default };\n",
    );
    expect(h).toHaveLength(1);
    expect(h[0]?.handler_function_name).toBe("handler");
  });

  it("collapses index routes: pages/api/webhooks/index.ts → /api/webhooks", async () => {
    const h = await handlersFor(
      "pages/api/webhooks/index.ts",
      "export default function handler(req, res) { res.end(); }\n",
    );
    expect(h[0]?.route_pattern).toBe("/api/webhooks");
  });

  it("keeps dynamic segments: pages/api/[id]/hook.ts → /api/[id]/hook", async () => {
    const h = await handlersFor(
      "pages/api/[id]/hook.ts",
      "export default function handler(req, res) { res.end(); }\n",
    );
    expect(h[0]?.route_pattern).toBe("/api/[id]/hook");
  });

  it("matches the src/pages/api/** prefix", async () => {
    const h = await handlersFor(
      "src/pages/api/stripe.ts",
      "export default function handler(req, res) { res.end(); }\n",
    );
    expect(h).toHaveLength(1);
    expect(h[0]?.route_pattern).toBe("/api/stripe");
  });

  it("infers method from a `switch (req.method)` with a POST case", async () => {
    const h = await handlersFor(
      "pages/api/webhook.ts",
      "export default function handler(req, res) {\n  switch (req.method) {\n    case 'POST': return res.json({ ok: 1 });\n    default: return res.status(405).end();\n  }\n}\n",
    );
    expect(h[0]?.http_methods).toEqual(["POST"]);
  });

  it("prefers the body method when both GET and POST are handled", async () => {
    const h = await handlersFor(
      "pages/api/webhook.ts",
      "export default function handler(req, res) {\n  if (req.method === 'GET') return res.end();\n  if (req.method === 'POST') return res.json({ ok: 1 });\n}\n",
    );
    expect(h[0]?.http_methods).toEqual(["POST"]);
  });

  // ── Negative / disjointness guards ──────────────────────────────────────────
  it("ignores non-api pages (pages/index.tsx)", async () => {
    const h = await handlersFor(
      "pages/index.tsx",
      "export default function Home() { return null; }\n",
    );
    expect(h).toHaveLength(0);
  });

  it("ignores App Router route files (owned by nextjsAdapter)", async () => {
    const h = await handlersFor(
      "app/api/webhooks/stripe/route.ts",
      "export const POST = async (req) => new Response('ok');\n",
    );
    expect(h).toHaveLength(0);
  });

  it("returns empty when there is no default export", async () => {
    const h = await handlersFor("pages/api/util.ts", "export function helper() { return 1; }\n");
    expect(h).toHaveLength(0);
  });

  it("returns empty for parse-error files", async () => {
    const file = await parseJsTs({ file_path: "pages/api/x.ts", source_text: "const x = ;" });
    expect(nextjsPagesAdapter(file, [file])).toEqual([]);
  });
});
