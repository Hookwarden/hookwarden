// End-to-end regressions for false positives found scanning real production apps (dub / cal.com).
// These run the FULL pipeline against the REAL bundled rule pack + provider catalog, so they guard
// the actual user-facing behavior — not just an isolated predicate.
//
// Three distinct FP classes, all confirmed against real source:
//   1. Generic-header attribution — an OAuth/cron/admin route that reads `Authorization` was
//      attributed to postmark (whose catalog signature_header is the generic `authorization`) and
//      flagged as an unverified postmark webhook.
//   2. Stripe v2 verify call — a webhook verified with `stripe.parseThinEvent(...)` was flagged
//      stripe/missing-signature-verification (the catalog only knew `constructEvent`).
//   3. Web-API raw body — a webhook reading `req.text()` + `constructEvent` was flagged
//      stripe/raw-body-misuse (the detector only knew express.raw / req.body).

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS } from "../src/config/precedence.js";
import { runScan } from "../src/pipeline.js";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "real-fp-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(tmp, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}
async function scan() {
  return runScan({
    rootPath: tmp,
    resolvedConfig: CONFIG_DEFAULTS,
    diffOnly: false,
    diffBase: null,
    baselineWrite: false,
    verbose: false,
  });
}

describe("real-app false-positive regressions (full pipeline, real catalog)", () => {
  it("an OAuth route that reads Authorization is NOT flagged as a postmark webhook", async () => {
    // dub: apps/web/app/api/oauth/token/route.ts — a token exchange, not a Postmark webhook.
    await write(
      "api/oauth/token/route.ts",
      `export async function POST(req: Request) {
         const auth = req.headers.get("authorization");
         const form = Object.fromEntries(await req.formData());
         void auth; void form;
         return Response.json({ access_token: "x" });
       }\n`,
    );
    const out = await scan();
    const postmark = out.result.findings.filter((f) => f.provider === "postmark");
    expect(postmark).toEqual([]);
  });

  it("still attributes a genuine postmark webhook (path signal), so the fix didn't blind us", async () => {
    await write(
      "server.ts",
      `import express from "express";
       const app = express();
       app.post("/webhooks/postmark", (req, res) => {
         const body = req.body;   // open: no Basic-Auth / IP check reachable
         void body;
         res.json({ ok: true });
       });\n`,
    );
    const out = await scan();
    expect(out.result.inventory.some((h) => h.provider === "postmark")).toBe(true);
  });

  it("a Stripe v2 webhook verified with parseThinEvent is NOT flagged missing-signature-verification", async () => {
    await write(
      "api/stripe/connect/v2/webhook/route.ts",
      `import Stripe from "stripe";
       import { stripe } from "@/lib/stripe";
       export const POST = async (req: Request) => {
         const buf = await req.text();
         const sig = req.headers.get("Stripe-Signature");
         const event = stripe.parseThinEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
         void event;
         return new Response("ok");
       };\n`,
    );
    const out = await scan();
    const missingSig = out.result.findings.filter(
      (f) => f.rule_id === "stripe/missing-signature-verification",
    );
    expect(missingSig).toEqual([]);
  });

  it("a correct App Router Stripe webhook (req.text() + constructEvent) fires NO critical", async () => {
    await write(
      "api/stripe/webhook/route.ts",
      `import Stripe from "stripe";
       import { stripe } from "@/lib/stripe";
       export const POST = async (req: Request) => {
         const buf = await req.text();
         const sig = req.headers.get("Stripe-Signature") as string;
         const event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
         void event;
         return new Response("ok");
       };\n`,
    );
    const out = await scan();
    const crit = out.result.findings.filter((f) => f.severity === "critical");
    expect(crit).toEqual([]);
  });
});
