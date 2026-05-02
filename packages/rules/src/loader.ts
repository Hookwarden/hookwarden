// Loads a pre-parsed RuleSet for engine consumption (D-03 — engine never reads YAML).
// Computes rule_pack_content_hash for ENGINE-08 / D-38 ScanMetadata.rule_pack_content_hash.
// Pure: no fs / http. The caller hands in already-parsed YAML documents + the predicate registry.

import type {
  DeclarativeMatcher,
  ProviderCatalog,
  RuleDefinition,
  RulePredicate,
  RuleSet,
} from "@hookwarden/engine";
import { validateRuleDocument, type ParsedMatcher, type ParsedRuleDocument } from "./schema.js";

export interface LoadRuleSetInput {
  // Caller (CLI / SaaS worker) reads YAML and parses it; this loader takes the parsed objects.
  readonly rule_documents: ReadonlyArray<unknown>;
  // The predicate registry — keys are referenced by rule_documents[].predicate.
  readonly predicates: Readonly<Record<string, RulePredicate>>;
  // The provider catalog — typically PROVIDER_CATALOG from this package.
  readonly providers: ProviderCatalog;
  // The semver of the rule pack. Caller reads from package.json; we don't.
  readonly rule_pack_version: string;
}

export async function loadRuleSet(input: LoadRuleSetInput): Promise<RuleSet> {
  const validated = input.rule_documents.map((doc) => validateRuleDocument(doc));
  // Cross-check: every rule that names a predicate has it registered, and every provider exists.
  for (const doc of validated) {
    if (doc.predicate !== null && !(doc.predicate in input.predicates)) {
      throw new Error(`rule ${doc.rule_id}: predicate '${doc.predicate}' not registered`);
    }
    if (!(doc.provider in input.providers)) {
      throw new Error(`rule ${doc.rule_id}: provider '${doc.provider}' missing from catalog`);
    }
  }
  const rules: ReadonlyArray<RuleDefinition> = validated.map(toRuleDefinition);
  return {
    schema_version: 1,
    rule_pack_version: input.rule_pack_version,
    providers: input.providers,
    rules,
    predicates: input.predicates,
  };
}

function toRuleDefinition(doc: ParsedRuleDocument): RuleDefinition {
  return {
    rule_id: doc.rule_id,
    provider: doc.provider,
    severity: doc.severity,
    emits_state: doc.emits_state,
    message: doc.message,
    matcher: doc.matcher === null ? null : toDeclarativeMatcher(doc.matcher),
    predicate_name: doc.predicate,
    applies_to: doc.applies_to as RuleDefinition["applies_to"],
  };
}

// Discriminated-union switch on matcher.name (no `satisfies … never` casts). Each branch hands back
// a concrete DeclarativeMatcher with statically-typed args, narrowed via the literal `name`.
function toDeclarativeMatcher(matcher: ParsedMatcher): DeclarativeMatcher {
  switch (matcher.name) {
    case "importMissing":
      return { name: "importMissing", args: { module: matcher.args.module } };
    case "callMatches":
      return { name: "callMatches", args: { qualified_name: matcher.args.qualified_name } };
    case "argumentEquals":
      return {
        name: "argumentEquals",
        args: {
          call: matcher.args.call,
          arg_index: matcher.args.arg_index,
          // DeclarativeMatcher.args's value type forbids null; canonicalize null → empty string.
          // The matcher implementation in Plan 08 treats both as "match no value".
          equals: matcher.args.equals === null ? "" : matcher.args.equals,
        },
      };
    case "middlewareOrder":
      return {
        name: "middlewareOrder",
        args: { before: matcher.args.before, after: matcher.args.after },
      };
    case "secretLiteralPrefix":
      return { name: "secretLiteralPrefix", args: { prefix: matcher.args.prefix } };
    case "signatureHeaderRead":
      return { name: "signatureHeaderRead", args: { header: matcher.args.header } };
    default: {
      // Exhaustiveness check: TS errors here if a matcher variant is added without a case.
      const _exhaustive: never = matcher;
      throw new Error(`unsupported matcher: ${(_exhaustive as { name: string }).name}`);
    }
  }
}

// Canonical JSON encoding: sorted keys, no whitespace.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < view.length; i++) out += (view[i] ?? 0).toString(16).padStart(2, "0");
  return out;
}

export async function computeContentHash(
  providers: ProviderCatalog,
  rule_documents: ReadonlyArray<ParsedRuleDocument>,
): Promise<string> {
  // Hash covers providers + rule docs (predicates are code, versioned via Changesets;
  // their version is captured via rule_pack_version). Stable across refactors that don't change data.
  const payload = canonicalize({ providers, rules: rule_documents });
  return sha256Hex(payload);
}
