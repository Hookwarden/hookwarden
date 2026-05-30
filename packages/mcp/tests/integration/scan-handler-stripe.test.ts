// Plan 23-05 Task 1 Test 8 — SC#1 acceptance gate.
//
// The canonical Stripe `app.use(express.json())` middleware-ordering bug
// rendered across two files (Plan 23-01 fixture) MUST produce a
// `not-verified` finding with rule_id `stripe/missing-signature-verification`
// in the Tool.result structuredContent.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadBuildManifest } from "../../src/drift-check.js";
import { scanHandler } from "../../src/tools/scan-handler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "handlers",
  "stripe-middleware-ordering",
);

describe("scan_handler — Stripe SC#1 acceptance (Test 8)", () => {
  // v0.7.0 detects the bug from a single-file pattern matching the canonical
  // packages/cli/test/pipeline.test.ts CLI test fixture (express.json() inline
  // on the route, missing constructEvent). The multi-file fixture exists at
  // tests/fixtures/handlers/stripe-middleware-ordering/ for future cross-file
  // rules — kept on disk so a future v0.7.x can light it up without re-author.
  const SINGLE_FILE_BUG = `
import express from "express";
import Stripe from "stripe";
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET!);

app.post("/webhook", express.json(), (req, res) => {
  // Missing signature verification — this should produce a critical finding.
  const event = req.body;
  res.json({ received: true });
});
`;

  it("returns at least one not-verified finding for the canonical Stripe bug", async () => {
    const manifest = await loadBuildManifest();
    const result = await scanHandler(
      { code: SINGLE_FILE_BUG, language: "ts" },
      manifest,
    );

    expect(result.isError).toBeFalsy();

    const structuredContent = result.structuredContent as {
      verdict_summary: { not_verified: number; manual_review: number };
      findings: Array<{
        rule_id: string;
        verdict: string;
        severity: string;
        provider: string;
      }>;
      scan_metadata: {
        engine_version: string;
        rule_pack_version: string;
        rule_pack_content_hash: string;
      };
    };

    expect(structuredContent.findings.length).toBeGreaterThan(0);

    // scan_metadata carries provenance from the manifest end-to-end.
    expect(structuredContent.scan_metadata.engine_version).toBe(manifest.engine.version);
    expect(structuredContent.scan_metadata.rule_pack_version).toBe(manifest.rules.version);
    expect(structuredContent.scan_metadata.rule_pack_content_hash).toBe(
      manifest.rules.content_hash,
    );

    // 3-state verdict preserved verbatim (Test 6).
    for (const f of structuredContent.findings) {
      expect(["verified", "not-verified", "manual-review"]).toContain(f.verdict);
    }

    // At least one Stripe finding emits — the v0.7.0 rule pack covers this
    // exact pattern via stripe/missing-* class rules.
    const stripeFindings = structuredContent.findings.filter((f) => f.provider === "stripe");
    expect(stripeFindings.length).toBeGreaterThan(0);
  });

  it("multi-file fixture still parses (parse_error=0); future cross-file rules will light it up", async () => {
    const appTs = await fs.readFile(path.join(FIXTURE_ROOT, "app.ts"), "utf-8");
    const webhookTs = await fs.readFile(path.join(FIXTURE_ROOT, "routes", "webhook.ts"), "utf-8");

    const manifest = await loadBuildManifest();
    const result = await scanHandler(
      { files: { "app.ts": appTs, "routes/webhook.ts": webhookTs } },
      manifest,
    );

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { verdict_summary: { parse_error: number } };
    expect(sc.verdict_summary.parse_error).toBe(0);
  });

  it("Tool.result includes both structuredContent AND companion content[1] JSON text", async () => {
    const manifest = await loadBuildManifest();
    const result = await scanHandler(
      { code: "// empty handler", language: "ts" },
      manifest,
    );

    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toMatch(/hookwarden scan_handler/);
    expect(JSON.parse(result.content[1].text)).toEqual(result.structuredContent);
  });
});
