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
export type RulePredicate = (handler: WebhookHandler, model: ProjectModel) => Promise<Verdict | null>;

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
}

export interface RuleSet {
  readonly schema_version: number; // engine refuses unknown versions
  readonly rule_pack_version: string; // matches @hookwarden/rules package version
  readonly providers: ProviderCatalog;
  readonly rules: ReadonlyArray<RuleDefinition>;
  readonly predicates: Readonly<Record<string, RulePredicate>>;
}
