// Phase 8.5 REACH-01 — queue-handler reachability overlay (engine integration).
//
// Proves both halves end-to-end via parse → buildProjectModel → evaluate (the project's standard
// verdict-logic harness, build.test.ts/evaluate.test.ts):
//   1. The build overlay emits `queue_verification_reachable` evidence ONLY when the handler enqueues
//      the raw body AND a verifying consumer for that backend is reachable.
//   2. The evaluator downgrades a not-verified verdict to manual-review on that evidence — never to
//      verified.
// Negatives (mandatory, SOC2 evidence per [[feedback_negative_tests_required]]): no consumer,
// unrelated-object enqueue, and a non-verifying consumer all leave the evidence absent (→ verdict
// floor holds).

import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/evaluate.js";
import { buildProjectModel } from "../../src/model/build.js";
import { parseJsTs } from "../../src/parsers/babel.js";
import type { Finding } from "../../src/types/finding.js";
import type { ProviderCatalog, RuleDefinition, RuleSet } from "../../src/types/rule-set.js";

const CATALOG: ProviderCatalog = {
  stripe: {
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe"],
    sdk_verify_calls: ["webhooks.constructEvent"],
    secret_env_prefix: ["STRIPE_WEBHOOK"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: ["/webhooks/stripe", "/api/webhooks/stripe"],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: ["missing-signature-verification"],
  },
};

// A minimal not-verified rule via a predicate: fires when the handler has NO sdk_verify_call evidence.
// (We don't import the real rules pack here — the engine test owns a tiny synthetic rule to drive the
// verdict, matching the build.test.ts/evaluate.test.ts convention of a local TEST_RULESET.)
const MISSING_VERIFY_RULE: RuleDefinition = {
  rule_id: "stripe/missing-signature-verification",
  provider: "stripe",
  severity: "critical",
  emits_state: "not-verified",
  message: "no verification",
  matcher: null,
  predicate_name: "test-missing-verify",
  applies_to: ["express"],
  provider_docs_url: "https://example.test",
  path_severity_overrides: null,
  references: null,
  compliance_mappings: null,
  fix: null,
};

const RULESET: RuleSet = {
  schema_version: 1,
  rule_pack_version: "0.0.1",
  providers: CATALOG,
  rules: [MISSING_VERIFY_RULE],
  predicates: {
    "test-missing-verify": (handler) =>
      handler.evidence.some((e) => e.kind === "sdk_verify_call") ? null : "not-verified",
  },
};

const CONFIG = {
  reachability_max_depth: 3,
  scanned_at: "2026-06-02T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 2,
} as const;

const HANDLER_BULLMQ = `
import express from 'express';
import { emailQueue } from './queue.js';
const app = express();
app.post('/webhooks/stripe', (req, res) => {
  emailQueue.add('verify-later', { body: req.body, sig: req.headers['stripe-signature'] });
  res.json({ received: true });
});
`;
const CONSUMER_BULLMQ = `
import { Worker } from 'bullmq';
import Stripe from 'stripe';
const stripe = new Stripe('sk');
new Worker('emailQueue', async (job) => {
  const event = stripe.webhooks.constructEvent(job.data.body, job.data.sig, process.env.STRIPE_WEBHOOK_SECRET);
  return event.id;
});
`;

async function buildAndEval(files: ReadonlyArray<{ path: string; src: string }>) {
  const parsed = await Promise.all(
    files.map((f) => parseJsTs({ file_path: f.path, source_text: f.src })),
  );
  const model = await buildProjectModel({ parsedFiles: parsed, ruleSet: RULESET, config: CONFIG });
  const result = await evaluate(model, RULESET, CONFIG);
  return { model, result };
}

function handlerHasQueueEvidence(
  model: Awaited<ReturnType<typeof buildAndEval>>["model"],
): boolean {
  return model.handlers.some((h) =>
    h.evidence.some((e) => e.kind === "queue_verification_reachable"),
  );
}

function stripeFindings(result: { findings: ReadonlyArray<Finding> }): ReadonlyArray<Finding> {
  return result.findings.filter((f) => f.rule_id === "stripe/missing-signature-verification");
}

describe("REACH-01 — positive: raw-body enqueue + verifying consumer", () => {
  it("bullmq: handler enqueues req.body, Worker verifies → manual-review (not not-verified)", async () => {
    const { model, result } = await buildAndEval([
      { path: "server.ts", src: HANDLER_BULLMQ },
      { path: "consumer.ts", src: CONSUMER_BULLMQ },
    ]);
    expect(handlerHasQueueEvidence(model)).toBe(true);
    const f = stripeFindings(result);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.state === "manual-review")).toBe(true);
    // NEVER verified.
    expect(f.some((x) => x.state === "verified")).toBe(false);
    expect(f[0]?.metadata.queue_verification_deferred).toBe(true);
  });

  it.each([
    [
      "sqs",
      `import express from 'express';\nimport { sqs } from './q.js';\nconst app=express();\napp.post('/webhooks/stripe',(req,res)=>{ sqs.sendMessage({ body: req.body }); res.end(); });`,
      `import Stripe from 'stripe';\nconst stripe=new Stripe('sk');\napp.consume(async (m)=>{ stripe.webhooks.constructEvent(m.body, m.sig, s); });`,
    ],
    [
      "inngest",
      `import express from 'express';\nimport { inngest } from './q.js';\nconst app=express();\napp.post('/webhooks/stripe',(req,res)=>{ inngest.send({ name:'e', data:{ body: req.body } }); res.end(); });`,
      `import Stripe from 'stripe';\nconst stripe=new Stripe('sk');\ninngest.createFunction({id:'f'},{event:'e'}, async ({ event }) => { stripe.webhooks.constructEvent(event.data.body, sig, s); });`,
    ],
    [
      "kafka",
      `import express from 'express';\nimport { producer } from './q.js';\nconst app=express();\napp.post('/webhooks/stripe',(req,res)=>{ producer.send({ topic:'t', messages:[{ value: req.body }] }); res.end(); });`,
      `import Stripe from 'stripe';\nconst stripe=new Stripe('sk');\nconsumer.run({ eachMessage: async ({ message }) => { stripe.webhooks.constructEvent(message.value, sig, s); } });`,
    ],
  ])("%s: enqueue raw body + verifying consumer → manual-review", async (_name, handler, consumer) => {
    const { model, result } = await buildAndEval([
      { path: "server.ts", src: handler },
      { path: "consumer.ts", src: consumer },
    ]);
    expect(handlerHasQueueEvidence(model)).toBe(true);
    expect(stripeFindings(result).every((x) => x.state === "manual-review")).toBe(true);
  });
});

describe("REACH-01 — NEGATIVE floors (verdict stays not-verified)", () => {
  it("enqueue with NO verifying consumer anywhere → not-verified", async () => {
    const { model, result } = await buildAndEval([{ path: "server.ts", src: HANDLER_BULLMQ }]);
    expect(handlerHasQueueEvidence(model)).toBe(false);
    expect(stripeFindings(result).every((x) => x.state === "not-verified")).toBe(true);
  });

  it("enqueue of an UNRELATED object (not the raw body) → not-verified", async () => {
    const handler = `
import express from 'express';
import { emailQueue } from './queue.js';
const app = express();
app.post('/webhooks/stripe', (req, res) => {
  emailQueue.add('job', { ping: 'pong', count: 1 });
  res.end();
});`;
    const { model, result } = await buildAndEval([
      { path: "server.ts", src: handler },
      { path: "consumer.ts", src: CONSUMER_BULLMQ },
    ]);
    expect(handlerHasQueueEvidence(model)).toBe(false);
    expect(stripeFindings(result).every((x) => x.state === "not-verified")).toBe(true);
  });

  it("consumer exists but does NOT verify → not-verified", async () => {
    const consumerNoVerify = `
import { Worker } from 'bullmq';
new Worker('emailQueue', async (job) => {
  await db.insert(job.data.body);
  return true;
});`;
    const { model, result } = await buildAndEval([
      { path: "server.ts", src: HANDLER_BULLMQ },
      { path: "consumer.ts", src: consumerNoVerify },
    ]);
    expect(handlerHasQueueEvidence(model)).toBe(false);
    expect(stripeFindings(result).every((x) => x.state === "not-verified")).toBe(true);
  });
});
