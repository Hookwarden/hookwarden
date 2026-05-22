// D-03: RuleSet is pre-parsed by the caller; engine never reads YAML.
// D-28: Declarative matchers + signed TS predicate escape hatch.
// D-29: Rule emits state directly.
// D-33: ProviderCatalog ships in @hookwarden/rules; consumed via RuleSet.

import type { Severity, Verdict } from "./finding.ts";
import type { WebhookHandler } from "./handler.ts";
import type { ProjectModel } from "./project-model.ts";

// D-33 provider evidence catalog entry. Single source of truth across engine + rules + Phase 11 leak-scan.
export interface ProviderCatalogEntry {
  readonly signature_header: ReadonlyArray<string>; // e.g. ["stripe-signature"]
  readonly sdk_packages: ReadonlyArray<string>; // e.g. ["stripe", "@stripe/stripe-js"]
  readonly sdk_verify_calls: ReadonlyArray<string>; // e.g. ["webhooks.constructEvent"]
  readonly secret_env_prefix: ReadonlyArray<string>; // e.g. ["STRIPE_WEBHOOK"]
  readonly secret_literal_prefix: ReadonlyArray<string>; // e.g. ["whsec_"]; consumed by Phase 11 leak-scan too
  readonly conventional_paths: ReadonlyArray<string>; // e.g. ["/webhooks/stripe", "/api/webhooks/stripe"]
  // D-91 signing-recipe extension; additive only.
  // Twilio (06.3) is the v1 outlier on sha1. Every other v1 provider uses sha256. The union is
  // intentionally narrow (no 'md5', 'sha224', 'sha384') so wrong-hmac-algorithm.ts can derive
  // WRONG_HINTS from a closed set. Adding sha1 was a discrete, reviewed type extension.
  readonly hmac_algorithm: "sha1" | "sha256" | "sha512";
  readonly signing_input_format:
    | "raw_body"
    | "timestamp_dot_body"
    | "url_plus_sorted_params"
    | "custom_field_tuple"
    | "custom";
  readonly timestamp_header: string | null;
  readonly signature_encoding: "hex" | "base64";
  readonly applicable_rules: ReadonlyArray<string>;
}

export type ProviderCatalog = Readonly<Record<string, ProviderCatalogEntry>>;

// D-28 declarative matcher names. Engine ships these matchers; rules pick from this menu.
export type MatcherName =
  | "importMissing"
  | "callMatches"
  | "argumentEquals"
  | "middlewareOrder"
  | "secretLiteralPrefix"
  | "signatureHeaderRead";

export interface DeclarativeMatcher {
  readonly name: MatcherName;
  readonly args: Readonly<Record<string, string | number | boolean | ReadonlyArray<string>>>;
}

// D-28 sandboxed predicate signature. Predicates live in @hookwarden/rules/predicates/* and run pure.
export type RulePredicate = (
  handler: WebhookHandler,
  model: ProjectModel,
) => Promise<Verdict | null>;

// D-57 RULES-05: per-rule severity downgrade based on file path globs. Engine applies post-emit
// (severity rewrite only — verification_state is NOT touched).
export interface PathSeverityOverride {
  readonly patterns: ReadonlyArray<string>; // glob patterns matched against Finding.file_path
  readonly severity: Severity; // replacement severity when any pattern matches
}

// Phase 8.2 D-01: per-rule auto-fix metadata. Engine ignores this; consumed by
// @hookwarden/fix (codegen registry + applyFixes) and the CLI fix subcommand.
// D-15: `codegen` MUST be null when safety is manual-only, non-empty string otherwise.
export interface FixMetadata {
  readonly safety: "safe" | "unsafe" | "manual-only";
  readonly description: string;
  readonly codegen: string | null;
}

// A single rule definition (already parsed from YAML by the caller per D-03).
export interface RuleDefinition {
  readonly rule_id: string; // e.g. "stripe/missing-verification"
  readonly provider: string; // resolved from catalog; rules MUST reference a known provider
  readonly severity: Severity;
  readonly emits_state: Verdict; // D-29 rule emits state directly
  readonly message: string; // human-readable
  readonly matcher: DeclarativeMatcher | null; // null when relying solely on a predicate
  readonly predicate_name: string | null; // resolves into RuleSet.predicates[name]
  readonly applies_to: ReadonlyArray<WebhookHandler["framework"]> | "all";
  // D-58 RULES-08: provider documentation URL — required for new rules; renderer surfaces as
  // `↳ <url>` line beneath each finding.
  readonly provider_docs_url: string;
  // D-57 RULES-05: optional path-glob-based severity downgrade applied by the engine post-emit.
  readonly path_severity_overrides: ReadonlyArray<PathSeverityOverride> | null;
  // Phase 8.2 D-01/D-04: per-rule auto-fix metadata. `null` is the explicit-binary signal
  // (rule has no fixable variant); a populated object is consumed by @hookwarden/fix.
  // Optional in Plan 02 (B4 — Plan 11 wave 7 tightens once every YAML has been populated).
  readonly fix?: FixMetadata | null;
}

export interface RuleSet {
  readonly schema_version: number; // engine refuses unknown versions
  readonly rule_pack_version: string; // matches @hookwarden/rules package version
  readonly providers: ProviderCatalog;
  readonly rules: ReadonlyArray<RuleDefinition>;
  readonly predicates: Readonly<Record<string, RulePredicate>>;
}
