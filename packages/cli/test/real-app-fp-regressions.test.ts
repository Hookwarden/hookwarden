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

// NOTE: Next.js App Router detection requires an `app/` segment AND a `route.ts` filename
// (ROUTE_FILE_RE in adapters/nextjs.ts). Fixtures MUST live under `app/api/.../route.ts` or no
// handler is detected and the absence-assertions pass vacuously. The "anti-vacuity guard" below
// proves detection works in this harness (a buggy webhook DOES get flagged), so the absence
// assertions are meaningful.
describe("real-app false-positive regressions (full pipeline, real catalog)", () => {
  it("anti-vacuity guard: a buggy App Router webhook (/api/webhook) IS flagged — detection works", async () => {
    await write(
      "app/api/webhook/route.ts",
      `import Stripe from "stripe";
       export const POST = async (req: Request) => {
         const event = await req.json();   // no verification — the canonical bug
         return Response.json({ ok: true, event });
       };\n`,
    );
    const out = await scan();
    // Webhookish path keeps the stripe attribution (its only stripe signal is the import) → flagged.
    // If this ever returns 0, App Router detection broke and the absence-tests below are vacuous.
    expect(out.result.findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("an OAuth route that reads Authorization is NOT flagged as a postmark webhook", async () => {
    // dub: apps/web/app/api/oauth/token/route.ts — a token exchange, not a Postmark webhook.
    await write(
      "app/api/oauth/token/route.ts",
      `export async function POST(req: Request) {
         const auth = req.headers.get("authorization");
         const form = Object.fromEntries(await req.formData());
         void auth; void form;
         return Response.json({ access_token: "x" });
       }\n`,
    );
    const out = await scan();
    expect(out.result.findings.filter((f) => f.provider === "postmark")).toEqual([]);
  });

  it("a non-webhook route that imports the Stripe SDK for an API call is NOT flagged (over-detection)", async () => {
    // dub: apps/web/app/api/workspaces/[idOrSlug]/billing/cancel/route.ts — calls
    // stripe.subscriptions.update; non-webhookish path; only signal is the SDK import.
    await write(
      "app/api/billing/cancel/route.ts",
      `import Stripe from "stripe";
       import { stripe } from "@/lib/stripe";
       export async function POST(req: Request) {
         const { id } = await req.json();
         await stripe.subscriptions.update(id, { cancel_at_period_end: true });
         return Response.json({ ok: true });
       }\n`,
    );
    const out = await scan();
    expect(out.result.findings.filter((f) => f.severity === "critical")).toEqual([]);
    // Demoted to provider:unknown (not a webhook receiver), so no stripe rule fires.
    const h = out.result.inventory.find((x) => x.file_path.includes("billing/cancel"));
    if (h) expect(h.provider).toBe("unknown");
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
      "app/api/stripe/webhook/v2/route.ts",
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
    expect(
      out.result.findings.filter((f) => f.rule_id === "stripe/missing-signature-verification"),
    ).toEqual([]);
  });

  it("a correct App Router Stripe webhook (req.text() + constructEvent) fires NO critical", async () => {
    await write(
      "app/api/stripe/webhook/route.ts",
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
    expect(out.result.findings.filter((f) => f.severity === "critical")).toEqual([]);
  });
});

// Remix support — documenso's real Stripe webhook (a Remix `action` under app/routes/) was
// previously invisible (0 handlers → silent "clean", a false negative). The adapter detects it and
// rules apply via the nextjs piggyback (both receive a Web Fetch Request).
describe("Remix adapter", () => {
  it("detects a Remix action webhook and attributes the provider (no longer a silent FN)", async () => {
    await write(
      "app/routes/api+/stripe.webhook.ts",
      `export async function action({ request }: { request: Request }) {
         const body = await request.json();   // delegated/none here — point is it's DETECTED
         return Response.json({ ok: true, body });
       }\n`,
    );
    const out = await scan();
    const remix = out.result.inventory.filter((h) => h.framework === "remix");
    expect(remix.length).toBe(1);
    expect(remix[0]?.route_pattern).toBe("/api/stripe/webhook"); // api+/ folder + `.` separator
    expect(remix[0]?.provider).toBe("stripe"); // conventional path attributes
  });

  it("anti-vacuity: an UNVERIFIED Remix stripe webhook IS flagged (nextjs rules apply to remix)", async () => {
    await write(
      "app/routes/webhooks.stripe.ts",
      `export async function action({ request }: { request: Request }) {
         const event = await request.json();   // no verification
         return Response.json({ ok: true, event });
       }\n`,
    );
    const out = await scan();
    expect(
      out.result.findings.some((f) => f.severity === "critical" && f.provider === "stripe"),
    ).toBe(true);
  });

  it("a correctly-verified Remix stripe webhook (req.text + constructEvent inline) fires NO critical", async () => {
    await write(
      "app/routes/webhooks.stripe.ts",
      `import Stripe from "stripe";
       import { stripe } from "~/lib/stripe";
       export async function action({ request }: { request: Request }) {
         const buf = await request.text();
         const sig = request.headers.get("stripe-signature") as string;
         const event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
         void event;
         return Response.json({ ok: true });
       }\n`,
    );
    const out = await scan();
    expect(out.result.findings.filter((f) => f.severity === "critical")).toEqual([]);
  });
});
