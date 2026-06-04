import { describe, expect, it } from "vitest";
import { nextjsAdapter } from "../../src/adapters/nextjs.js";
import { parseJsTs } from "../../src/parsers/babel.js";

describe("nextjsAdapter", () => {
  it("detects POST export from app/api/webhooks/stripe/route.ts", async () => {
    const file = await parseJsTs({
      file_path: "app/api/webhooks/stripe/route.ts",
      source_text:
        "export async function POST(req: Request) {\n" +
        "  const body = await req.text();\n" +
        "  return new Response('ok');\n" +
        "}\n",
    });
    const handlers = nextjsAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("nextjs");
    expect(handlers[0]?.route_pattern).toBe("/api/webhooks/stripe");
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
    expect(handlers[0]?.handler_function_name).toBe("POST");
    expect(handlers[0]?.framework_version).toBeNull();
  });

  it("detects const POST = ... arrow exports", async () => {
    const file = await parseJsTs({
      file_path: "app/webhooks/github/route.ts",
      source_text: "export const POST = async (req: Request) => new Response('ok');\n",
    });
    const handlers = nextjsAdapter(file, [file]);
    expect(handlers[0]?.route_pattern).toBe("/webhooks/github");
  });

  it("detects `export { handler as POST }` specifier re-export of a local binding (saasfly shape)", async () => {
    const file = await parseJsTs({
      file_path: "apps/nextjs/src/app/api/webhooks/stripe/route.ts",
      source_text:
        "const handler = async (req: Request) => new Response('ok');\n" +
        "export { handler as GET, handler as POST };\n",
    });
    const handlers = nextjsAdapter(file, [file]);
    // GET is filtered (not body-bearing); POST resolves to the local `handler` function.
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
    expect(handlers[0]?.route_pattern).toBe("/api/webhooks/stripe");
    expect(handlers[0]?.handler_body_node).toBeDefined();
  });

  it("ignores `export { x } from './other'` cross-module re-exports (cannot resolve the fn)", async () => {
    const file = await parseJsTs({
      file_path: "app/api/webhooks/stripe/route.ts",
      source_text: "export { POST } from './impl';\n",
    });
    expect(nextjsAdapter(file, [file])).toHaveLength(0);
  });

  it("ignores GET-only handlers (webhooks are body-bearing)", async () => {
    const file = await parseJsTs({
      file_path: "app/api/healthz/route.ts",
      source_text: "export async function GET() { return new Response('ok'); }\n",
    });
    expect(nextjsAdapter(file, [file])).toHaveLength(0);
  });

  it("ignores non-route files even under app/", async () => {
    const file = await parseJsTs({
      file_path: "app/api/webhooks/stripe/util.ts",
      source_text: "export async function POST() { return new Response('ok'); }\n",
    });
    expect(nextjsAdapter(file, [file])).toHaveLength(0);
  });

  it("returns empty for parse-error files", async () => {
    const file = await parseJsTs({ file_path: "app/api/x/route.ts", source_text: "const x = ;" });
    expect(nextjsAdapter(file, [file])).toEqual([]);
  });
});
