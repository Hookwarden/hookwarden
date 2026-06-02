// Phase 8.5 REACH-02 — edge-runtime adapter (engine integration).
//
// Proves the three runtime entry points are DETECTED with the correct framework, and that downstream
// evidence/verdict works (parse→build→evaluate). Positive: Workers / Vercel Edge / Deno that verify
// the Stripe signature → verified. Negative (mandatory, SOC2 evidence per
// [[feedback_negative_tests_required]]): a Workers handler that reads the raw body but skips
// verification → not-verified (edge detection does NOT auto-pass).

import { describe, expect, it } from "vitest";
import { edgeRuntimeAdapter } from "../src/adapters/index.js";
import { evaluate } from "../src/evaluate.js";
import { buildProjectModel } from "../src/model/build.js";
import { parseJsTs } from "../src/parsers/babel.js";
import type { Finding } from "../src/types/finding.js";
import type { ProviderCatalog, RuleDefinition, RuleSet } from "../src/types/rule-set.js";

const CATALOG: ProviderCatalog = {
  stripe: {
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe"],
    sdk_verify_calls: ["webhooks.constructEvent"],
    secret_env_prefix: ["STRIPE_WEBHOOK"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: ["/webhooks/stripe"],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: ["library-verified", "missing-signature-verification"],
  },
};

const APPLIES = ["express", "cloudflare-workers", "vercel-edge", "deno"];
function rule(id: string, state: "verified" | "not-verified", predicate: string): RuleDefinition {
  return {
    rule_id: `stripe/${id}`,
    provider: "stripe",
    severity: state === "verified" ? "info" : "critical",
    emits_state: state,
    message: id,
    matcher: null,
    predicate_name: predicate,
    applies_to: APPLIES,
    provider_docs_url: "https://example.test",
    path_severity_overrides: null,
    references: null,
    compliance_mappings: null,
    fix: null,
  };
}

const RULESET: RuleSet = {
  schema_version: 1,
  rule_pack_version: "0.0.1",
  providers: CATALOG,
  rules: [
    rule("library-verified", "verified", "test-has-verify"),
    rule("missing-signature-verification", "not-verified", "test-missing-verify"),
  ],
  predicates: {
    "test-has-verify": (h) =>
      h.evidence.some((e) => e.kind === "sdk_verify_call") ? "verified" : null,
    "test-missing-verify": (h) =>
      h.evidence.some((e) => e.kind === "sdk_verify_call") ? null : "not-verified",
  },
};

const CONFIG = {
  reachability_max_depth: 3,
  scanned_at: "2026-06-02T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
} as const;

async function buildAndEval(src: string) {
  const parsed = await parseJsTs({ file_path: "handler.ts", source_text: src });
  const model = await buildProjectModel({
    parsedFiles: [parsed],
    ruleSet: RULESET,
    config: CONFIG,
    bespokeAdapters: [edgeRuntimeAdapter],
  });
  const result = await evaluate(model, RULESET, CONFIG);
  return { model, result };
}

function stripeStates(result: { findings: ReadonlyArray<Finding> }): string[] {
  return result.findings.filter((f) => f.rule_id.startsWith("stripe/")).map((f) => f.state);
}

const WORKERS_VERIFIED = `
import Stripe from 'stripe';
const stripe = new Stripe('sk');
export default {
  async fetch(req) {
    const raw = await req.text();
    const sig = req.headers.get('stripe-signature');
    const event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
    return new Response(JSON.stringify({ id: event.id }));
  },
};
`;

const VERCEL_EDGE_VERIFIED = `
import Stripe from 'stripe';
const stripe = new Stripe('sk');
export const config = { runtime: 'edge' };
export async function POST(req) {
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  return new Response('ok');
}
`;

const DENO_VERIFIED = `
import Stripe from 'stripe';
const stripe = new Stripe('sk');
Deno.serve(async (req) => {
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  stripe.webhooks.constructEvent(raw, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET'));
  return new Response('ok');
});
`;

describe("REACH-02 — edge-runtime detection + verified verdict", () => {
  it("Cloudflare Workers (export default {fetch}) → detected + verified", async () => {
    const { model, result } = await buildAndEval(WORKERS_VERIFIED);
    expect(model.handlers.some((h) => h.framework === "cloudflare-workers")).toBe(true);
    expect(stripeStates(result)).toContain("verified");
    expect(stripeStates(result)).not.toContain("not-verified");
  });

  it("Vercel Edge (runtime:'edge' + POST) → detected + verified", async () => {
    const { model, result } = await buildAndEval(VERCEL_EDGE_VERIFIED);
    expect(model.handlers.some((h) => h.framework === "vercel-edge")).toBe(true);
    expect(stripeStates(result)).toContain("verified");
  });

  it("Deno (Deno.serve) → detected + verified", async () => {
    const { model, result } = await buildAndEval(DENO_VERIFIED);
    expect(model.handlers.some((h) => h.framework === "deno")).toBe(true);
    expect(stripeStates(result)).toContain("verified");
  });
});

describe("REACH-02 — NEGATIVE: edge handler that skips verification", () => {
  it("Workers handler reading raw body but NOT verifying → not-verified", async () => {
    const src = `
export default {
  async fetch(req) {
    const raw = await req.text();
    await db.insert({ body: raw, sig: req.headers.get('stripe-signature') });
    return new Response('ok');
  },
};
`;
    const { model, result } = await buildAndEval(src);
    expect(model.handlers.some((h) => h.framework === "cloudflare-workers")).toBe(true);
    expect(stripeStates(result)).toContain("not-verified");
    expect(stripeStates(result)).not.toContain("verified");
  });
});
