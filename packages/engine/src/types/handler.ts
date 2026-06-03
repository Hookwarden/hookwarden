// D-32: WebhookEvidence multi-signal model — engine computes, rules query thresholds.
// D-34: ReachableSymbol bounded-depth reachability set per WebhookHandler.
// D-36: WebhookHandler shape — every field used by Phase 3 CLI inventory + Phase 8 SaaS dashboard.
// D-37: WebhookHandler.id derivation locked.
// D-39: redacted_snippet is structurally redacted.

import type { FindingId, SourceLocation, Verdict } from "./finding.ts";

export type Framework =
  | "express"
  | "hono"
  | "fastify"
  | "nextjs"
  // Remix `action`/`loader` route modules under app/routes/. Receive a Web Fetch API Request,
  // identical to Next.js App Router — the engine matches nextjs rules to remix handlers
  // (ruleAppliesToFramework), so rule YAMLs need not list "remix" individually.
  | "remix"
  // Phase 8.5 (REACH-02): edge-runtime entry points without a framework router —
  // Cloudflare Workers (`export default { fetch }`), Vercel Edge (`runtime: 'edge'`),
  // and Deno (`Deno.serve`). MUST stay in sync with the Ajv `applies_to` enum in
  // @hookwarden/rules schema.ts (both move together or rule loading throws).
  | "cloudflare-workers"
  | "vercel-edge"
  | "deno"
  | "flask"
  | "fastapi"
  | "django"
  | "laravel"
  | "symfony"
  | "slim"
  | "vanilla-php"
  // Phase 24 (AGENT-01): the n8n JSON-workflow synthetic handler. NOT an AST-backed
  // code framework — the n8n adapter emits these directly (no babel/tree-sitter parse).
  // MUST stay in sync with the Ajv `applies_to` enum in @hookwarden/rules schema.ts;
  // rule loading throws if a rule targets a framework the engine union does not declare.
  | "n8n-workflow"
  // Phase 27 (RULES-GO-01): the four Go webhook frameworks. MUST stay in sync with the
  // Ajv applies_to enum in @hookwarden/rules schema.ts; rule loading throws if a rule
  // targets a framework the engine union does not declare.
  | "net-http-go"
  | "chi"
  | "gin"
  | "echo";

// D-32 multi-signal evidence. Engine computes; rules query thresholds.
// `side_effect_before_verify` is the v0.7 Rule Depth extension — emitted by the
// handler-cfg overlay in assembleHandler when a T1 side effect (DB write,
// outbound HTTP non-provider, event emit, file write outside log paths)
// executes BEFORE the verification call in handler scope. Consumed by the
// verify-after-side-effect rule class (VAS-01). The kind never appears
// without a matching `sdk_verify_call` evidence emitted elsewhere — if
// verification can't be found in handler scope at all, that's a different
// finding (missing-signature-verification).
export type WebhookEvidenceKind =
  | "path_pattern_match"
  | "signature_header_read"
  | "sdk_import"
  | "sdk_verify_call"
  | "body_as_bytes_or_buffer"
  | "secret_env_var_reference"
  | "secret_literal_match"
  | "side_effect_before_verify"
  // Phase 24 (AGENT-01): n8n synthetic-handler node parameters, emitted by the n8n
  // adapter/model wiring (Plan 24-03) one per Webhook trigger node. `detail` encodes a
  // single key=value node param (e.g. "authentication=none", "httpMethod=POST"). The
  // n8n trigger-auth predicate reads "authentication=<value>" off this kind.
  | "n8n_node_param"
  // Phase 8.5 (REACH-01): the handler enqueues the raw request body via a known queue backend
  // (bullmq/sqs/inngest/kafka) AND a consumer of that backend has signature verification reachable.
  // Emitted by the queue-reachability overlay in assembleHandler. The evaluator downgrades a
  // not-verified verdict on such a handler to manual-review (never verified — same-payload
  // verification can't be proven across the queue boundary). `detail` names the backend.
  | "queue_verification_reachable";

export interface WebhookEvidence {
  readonly kind: WebhookEvidenceKind;
  readonly provider: string; // resolved against provider catalog; "unknown" if not catalog-attributable
  readonly location: SourceLocation;
  readonly detail: string; // e.g. matched header name, package name, regex pattern label
}

export interface ResolvedMiddleware {
  readonly name: string; // e.g. "express.json"
  readonly import_source: string | null; // e.g. "express" or null if local function
  readonly position: number; // 0-indexed within the chain
  readonly location: SourceLocation;
}

// D-34 bounded-depth reachability. Set lookup target for "is constructEvent reachable?"
export interface ReachableSymbol {
  readonly qualified_name: string; // e.g. "stripe.webhooks.constructEvent" (post-resolution)
  readonly import_source: string | null; // e.g. "stripe"
  readonly hops: number; // 0 = direct call in handler; <= config.reachability_max_depth
  readonly via: string; // descriptive trace summary
}

// D-36 contract — every field used by Phase 3 CLI inventory + Phase 8 SaaS Inventory dashboard.
export interface WebhookHandler {
  readonly id: string; // D-37 sha256 of file_path|route|methods|fn_name
  readonly framework: Framework;
  readonly framework_version: string | null; // e.g. "express@4" if statically detectable
  readonly route_pattern: string; // normalized "/webhooks/stripe"
  readonly http_methods: ReadonlyArray<string>; // sorted, uppercase: ["POST"]
  readonly file_path: string; // repo-relative
  readonly location: SourceLocation;
  readonly handler_function_name: string | null; // null for arrow functions
  readonly provider: string; // resolved provider | "unknown" | "multiple"
  readonly verification_state: Verdict; // worst rule verdict on this handler
  readonly evidence: ReadonlyArray<WebhookEvidence>;
  readonly middleware_chain: ReadonlyArray<ResolvedMiddleware>;
  readonly reachable_symbols: ReadonlyArray<ReachableSymbol>;
  readonly findings_ref: ReadonlyArray<FindingId>;
  readonly redacted_snippet: string; // D-39
}
