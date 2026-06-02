// Phase 8.5 Plan 06 — corpus FP gate for the new overlays/rules (REACH-01 / REACH-02 / DISCORD-01).
//
// Runs the Phase 8.5 patterns through the REAL bundled rule pack end-to-end (parse → build → evaluate
// with ALL_ADAPTERS + ALL_PREDICATES) — stronger than the per-feature tests, which used synthetic
// rulesets. Asserts:
//   - SC#5 FP discipline: the "safe-form" cases (queue-with-verifying-consumer, edge-verified,
//     discord-verified) produce ZERO high/critical not-verified findings. FP-rate ≤ 5% (here 0).
//   - The intended manual-review shift IS a shift, not a false negative (queue case is manual-review).
//   - The 3 corpus-wide negatives remain TRUE positives (no-consumer / edge-skip / discord-missing
//     all still flagged not-verified — the overlays don't blanket-suppress).
//
// Corpus floor (plan-check Warning 3): no standalone 200-handler corpus directory exists in the repo;
// per the Plan 06 fallback this gate uses the union of the Phase 8.5 pattern fixtures as the corpus
// floor. The before/after FP delta is valid for these handlers; SC#6 engine purity is enforced
// separately by `pnpm purity` (dependency-cruiser, green).

import {
  ALL_ADAPTERS,
  buildProjectModel,
  type Config,
  evaluate,
  parseJsTs,
} from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import {
  ALL_PREDICATES,
  BUNDLED_RULE_DOCUMENTS,
  loadRuleSet,
  PROVIDER_CATALOG,
  RULES_PACK_VERSION,
} from "../src/index.js";

const CONFIG: Config = {
  reachability_max_depth: 3,
  scanned_at: "2026-06-02T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 2,
};

async function loadBundledRuleSet() {
  return loadRuleSet({
    rule_documents: BUNDLED_RULE_DOCUMENTS.map((e) => e.doc),
    predicates: ALL_PREDICATES,
    providers: PROVIDER_CATALOG,
    rule_pack_version: RULES_PACK_VERSION,
  });
}

async function scan(files: ReadonlyArray<{ path: string; src: string }>) {
  const ruleSet = await loadBundledRuleSet();
  const parsed = await Promise.all(
    files.map((f) => parseJsTs({ file_path: f.path, source_text: f.src })),
  );
  const model = await buildProjectModel({
    parsedFiles: parsed,
    ruleSet,
    config: CONFIG,
    bespokeAdapters: ALL_ADAPTERS,
  });
  return evaluate(model, ruleSet, CONFIG);
}

const HIGH_CRIT = new Set(["high", "critical"]);
function highCritNotVerified(result: {
  findings: ReadonlyArray<{ state: string; severity: string }>;
}) {
  return result.findings.filter((f) => f.state === "not-verified" && HIGH_CRIT.has(f.severity));
}

// --- "Safe form" Phase 8.5 fixtures (must NOT produce high/critical not-verified) ---
const QUEUE_VERIFIED = [
  {
    path: "server.ts",
    src: `import express from 'express';\nimport { emailQueue } from './q.js';\nconst app=express();\napp.post('/webhooks/stripe',(req,res)=>{ emailQueue.add('job',{ body: req.body, sig: req.headers['stripe-signature'] }); res.json({ok:1}); });`,
  },
  {
    path: "consumer.ts",
    src: `import { Worker } from 'bullmq';\nimport Stripe from 'stripe';\nconst stripe=new Stripe('sk');\nnew Worker('emailQueue', async (job)=>{ stripe.webhooks.constructEvent(job.data.body, job.data.sig, process.env.STRIPE_WEBHOOK_SECRET); });`,
  },
];
const EDGE_VERIFIED = [
  {
    path: "worker.ts",
    src: `import Stripe from 'stripe';\nconst stripe=new Stripe('sk');\nexport default { async fetch(req){ const raw=await req.text(); const sig=req.headers.get('stripe-signature'); stripe.webhooks.constructEvent(raw,sig,process.env.STRIPE_WEBHOOK_SECRET); return new Response('ok'); } };`,
  },
];
const DISCORD_VERIFIED = [
  {
    path: "interactions.ts",
    src: `import { verifyKey } from 'discord-interactions';\nimport express from 'express';\nconst app=express();\napp.post('/api/discord/interactions',(req,res)=>{ const ok = verifyKey(req.rawBody, req.headers['x-signature-ed25519'], req.headers['x-signature-timestamp'], process.env.DISCORD_PUBLIC_KEY); if(!ok) return res.status(401).end(); res.json({type:1}); });`,
  },
];

describe("Phase 8.5 corpus FP gate — safe forms produce no high/critical not-verified (SC#5)", () => {
  it("queue-with-verifying-consumer → manual-review, not high/critical not-verified", async () => {
    const result = await scan(QUEUE_VERIFIED);
    expect(highCritNotVerified(result)).toHaveLength(0);
    // The intended shift actually happened (manual-review present, not a false negative).
    expect(result.findings.some((f) => f.state === "manual-review")).toBe(true);
  });
  it("edge (Workers) verified → no high/critical not-verified", async () => {
    expect(highCritNotVerified(await scan(EDGE_VERIFIED))).toHaveLength(0);
  });
  it("discord verified → no high/critical not-verified", async () => {
    expect(highCritNotVerified(await scan(DISCORD_VERIFIED))).toHaveLength(0);
  });

  it("aggregate FP-rate over the Phase 8.5 safe-form corpus floor is ≤ 5% (here 0)", async () => {
    const corpus = [QUEUE_VERIFIED, EDGE_VERIFIED, DISCORD_VERIFIED];
    let fp = 0;
    for (const c of corpus) fp += highCritNotVerified(await scan(c)).length;
    const fpRate = fp / corpus.length;
    expect(fpRate).toBeLessThanOrEqual(0.05);
  });
});

// --- True-positive negatives: the overlays must NOT blanket-suppress real bugs ---
describe("Phase 8.5 corpus FP gate — true-positive floors hold (no blanket suppression)", () => {
  it("queue enqueue with NO verifying consumer → still not-verified", async () => {
    const result = await scan([QUEUE_VERIFIED[0] as { path: string; src: string }]); // handler only, no consumer file
    expect(result.findings.some((f) => f.state === "not-verified")).toBe(true);
  });
  it("edge handler that skips verification → not-verified", async () => {
    const result = await scan([
      {
        path: "worker.ts",
        src: `export default { async fetch(req){ const raw=await req.text(); await db.insert({ body: raw, sig: req.headers.get('stripe-signature') }); return new Response('ok'); } };`,
      },
    ]);
    expect(result.findings.some((f) => f.state === "not-verified")).toBe(true);
  });
  it("discord interactions handler missing verifyKey → not-verified", async () => {
    const result = await scan([
      {
        path: "interactions.ts",
        src: `import { InteractionType } from 'discord-interactions';\nimport express from 'express';\nconst app=express();\napp.post('/api/discord/interactions',(req,res)=>{ const sig=req.headers['x-signature-ed25519']; if(req.body.type===InteractionType.PING) return res.json({type:1}); res.json({type:4}); });`,
      },
    ]);
    expect(result.findings.some((f) => f.state === "not-verified")).toBe(true);
  });
});
