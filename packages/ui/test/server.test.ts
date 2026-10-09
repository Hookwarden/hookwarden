import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { renderReport, startUiServer, type UiHandlers, type UiServer } from "../src/index.js";

const ROOT = "/tmp/hw-ui-project";
let server: UiServer | null = null;
const calls: string[] = [];

const handlers: UiHandlers = {
  async scan() {
    calls.push("scan");
    return { scan: { findings: [] } };
  },
  async previewFix(t) {
    calls.push(`preview:${t.ruleId}:${t.file}`);
    return [];
  },
  async applyFix(t) {
    calls.push(`apply-start:${t.file}`);
    await new Promise((r) => setTimeout(r, 30));
    calls.push(`apply-end:${t.file}`);
    return { applied: 1, scan: { scan: { findings: [] } } };
  },
};

async function start(): Promise<UiServer> {
  calls.length = 0;
  server = await startUiServer({ root: ROOT, handlers });
  return server;
}

afterEach(async () => {
  await server?.close();
  server = null;
});

function call(
  s: UiServer,
  method: string,
  route: string,
  opts: { token?: string | null; host?: string; body?: unknown } = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${s.port}` };
    const token = opts.token === undefined ? s.token : opts.token;
    if (token !== null) headers["authorization"] = `Bearer ${token}`;
    const payload = opts.body === undefined ? "" : JSON.stringify(opts.body);
    const req = request(
      { host: "127.0.0.1", port: s.port, method, path: route, headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

describe("startUiServer", () => {
  it("binds 127.0.0.1 and puts the token in the URL fragment", async () => {
    const s = await start();
    expect(s.url).toBe(`http://127.0.0.1:${s.port}/#t=${s.token}`);
    expect(s.token.length).toBeGreaterThanOrEqual(32);
  });

  it("serves the app with a script-hash CSP and no token needed", async () => {
    const s = await start();
    const r = await call(s, "GET", "/", { token: null });
    expect(r.status).toBe(200);
    expect(r.body).toContain('<div id="app">');
    expect(String(r.headers["content-security-policy"])).toMatch(
      /script-src 'sha256-[A-Za-z0-9+/=]+'/,
    );
    expect(String(r.headers["content-security-policy"])).toContain("connect-src 'self'");
  });

  it("rejects API calls without or with a wrong token", async () => {
    const s = await start();
    expect((await call(s, "POST", "/api/scan", { token: null })).status).toBe(401);
    expect((await call(s, "POST", "/api/scan", { token: "x".repeat(s.token.length) })).status).toBe(
      401,
    );
    expect(calls).toEqual([]);
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const s = await start();
    const r = await call(s, "POST", "/api/scan", { host: `evil.example:${s.port}` });
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("accepts localhost as a Host", async () => {
    const s = await start();
    expect((await call(s, "POST", "/api/scan", { host: `localhost:${s.port}` })).status).toBe(200);
  });

  it("runs a scan and returns the root with the envelope", async () => {
    const s = await start();
    const r = await call(s, "POST", "/api/scan");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ root: ROOT, scan: { findings: [] } });
  });

  it.each([
    [{ ruleId: "stripe/missing-signature-verification", file: "../outside.js" }, "outside"],
    [{ ruleId: "stripe/missing-signature-verification", file: "/etc/passwd" }, "relative"],
    [{ ruleId: "stripe/missing-signature-verification", file: "a/../../b.js" }, "outside"],
    [{ ruleId: "../../x", file: "a.js" }, "ruleId"],
    [{ ruleId: "stripe/missing-signature-verification" }, "relative"],
  ])("rejects an unsafe fix target %j", async (body, msg) => {
    const s = await start();
    const r = await call(s, "POST", "/api/fix/apply", { body });
    expect(r.status).toBe(400);
    expect(r.body).toContain(msg);
    expect(calls).toEqual([]);
  });

  it("previews and applies a fix inside the root", async () => {
    const s = await start();
    const target = { ruleId: "stripe/raw-body-misuse", file: "src/webhook.js" };
    const p = await call(s, "POST", "/api/fix/preview", { body: target });
    expect(JSON.parse(p.body)).toEqual({ edits: [] });
    const a = await call(s, "POST", "/api/fix/apply", { body: target });
    expect(JSON.parse(a.body)).toEqual({ root: ROOT, applied: 1, scan: { findings: [] } });
  });

  it("serializes requests so applies never interleave", async () => {
    const s = await start();
    const body = (file: string) => ({ body: { ruleId: "stripe/raw-body-misuse", file } });
    await Promise.all([
      call(s, "POST", "/api/fix/apply", body("a.js")),
      call(s, "POST", "/api/fix/apply", body("b.js")),
    ]);
    expect(calls).toEqual([
      "apply-start:a.js",
      "apply-end:a.js",
      "apply-start:b.js",
      "apply-end:b.js",
    ]);
  });

  it("rejects non-JSON and oversized bodies", async () => {
    const s = await start();
    expect(
      (await call(s, "POST", "/api/fix/preview", { body: "x".repeat(70 * 1024) })).status,
    ).toBe(413);
  });
});

describe("renderReport", () => {
  const envelope = JSON.stringify({
    scan: { findings: [{ message: "</script><script>alert(1)</script>" }] },
  });

  it("embeds the scan without letting finding text close the tag", () => {
    const html = renderReport(envelope);
    const m = html.match(/<script type="application\/json" id="hw-data">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m?.[1] ?? "")).toEqual(JSON.parse(envelope));
    expect(html).not.toContain("</script><script>alert(1)");
  });

  it("is self-contained and cannot fetch", () => {
    const html = renderReport(envelope);
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'none'/,
    );
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)="https?:/);
  });
});
