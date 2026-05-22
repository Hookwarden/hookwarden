// D-03 schema_version: 1. Validates a parsed YAML object against the rule schema.
// Rejects unknown fields per ARCHITECTURE.md: "Use Yamale or Ajv with a strict schema; reject unknown fields."

import { Ajv, type ValidateFunction } from "ajv";

// Discriminated union — one variant per matcher menu entry. Keep aligned with @hookwarden/engine
// MatcherName. Adding a matcher to the engine MUST add a variant here AND a case in loader.ts.
export type ParsedMatcher =
  | { readonly name: "importMissing"; readonly args: { readonly module: string } }
  | { readonly name: "callMatches"; readonly args: { readonly qualified_name: string } }
  | {
      readonly name: "argumentEquals";
      readonly args: {
        readonly call: string;
        readonly arg_index: number;
        readonly equals: string | number | null;
      };
    }
  | {
      readonly name: "middlewareOrder";
      readonly args: { readonly before: string; readonly after: string };
    }
  | { readonly name: "secretLiteralPrefix"; readonly args: { readonly prefix: string } }
  | { readonly name: "signatureHeaderRead"; readonly args: { readonly header: string } };

export interface ParsedRuleDocument {
  readonly schema_version: number;
  readonly rule_id: string;
  readonly provider: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly emits_state: "verified" | "not-verified" | "manual-review";
  readonly message: string;
  readonly matcher: ParsedMatcher | null;
  readonly predicate: string | null;
  readonly applies_to: ReadonlyArray<string> | "all";
  // D-58 RULES-08: provider documentation URL — required.
  readonly provider_docs_url: string;
  // D-57 RULES-05: optional path-glob severity downgrade applied post-emit by the engine.
  readonly path_severity_overrides: ReadonlyArray<{
    readonly patterns: ReadonlyArray<string>;
    readonly severity: "critical" | "high" | "medium" | "low" | "info";
  }> | null;
  // Phase 8.2 D-01 / D-04 / D-15: per-rule auto-fix metadata.
  // Optional in Plan 02 wave 1 (B4 — Plan 11 wave 7 tightens to required after
  // every YAML in packages/rules/rules/ has been populated with a fix: block).
  readonly fix?: {
    readonly safety: "safe" | "unsafe" | "manual-only";
    readonly description: string;
    readonly codegen: string | null;
  } | null;
}

const SCHEMA = {
  $id: "hookwarden-rule-document-v1",
  type: "object",
  additionalProperties: false,
  // TODO(Plan-11-wave-7): add "fix" to required[] per D-04 explicit-binary.
  // B4 — Plan 02 wave 1 ships fix as optional; Plan 11 wave 7's final task tightens
  // after every YAML in packages/rules/rules/ has been populated with a fix: block.
  // Splitting the tightening across waves keeps main green through waves 2-6 builds
  // (which would otherwise fail the existing rule-pack vitest with a missing-required-property error).
  required: [
    "schema_version",
    "rule_id",
    "provider",
    "severity",
    "emits_state",
    "message",
    "applies_to",
    "provider_docs_url", // D-58 RULES-08
  ],
  properties: {
    schema_version: { type: "integer", const: 1 },
    rule_id: { type: "string", pattern: "^[a-z0-9-]+/[a-z0-9-]+$" },
    provider: { type: "string", pattern: "^[a-z0-9-]+$" },
    severity: { enum: ["critical", "high", "medium", "low", "info"] },
    emits_state: { enum: ["verified", "not-verified", "manual-review"] },
    message: { type: "string", minLength: 1 },
    matcher: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["name", "args"],
          properties: {
            name: {
              enum: [
                "importMissing",
                "callMatches",
                "argumentEquals",
                "middlewareOrder",
                "secretLiteralPrefix",
                "signatureHeaderRead",
              ],
            },
            args: { type: "object" },
          },
        },
      ],
    },
    predicate: { anyOf: [{ type: "null" }, { type: "string", minLength: 1 }] },
    applies_to: {
      anyOf: [
        { const: "all" },
        {
          type: "array",
          minItems: 1,
          items: {
            // Keep in sync with engine's Framework union — Phase 8.1 added PHP frameworks.
            enum: [
              "express",
              "hono",
              "fastify",
              "nextjs",
              "flask",
              "fastapi",
              "django",
              "laravel",
              "symfony",
              "slim",
              "vanilla-php",
            ],
          },
        },
      ],
    },
    // D-58 RULES-08: simple URL guard (full validation is documentation review, not a regex).
    provider_docs_url: {
      type: "string",
      minLength: 1,
      pattern: "^https?://",
    },
    // D-57 RULES-05: optional. When omitted in YAML, loader normalizes to null.
    path_severity_overrides: {
      anyOf: [
        { type: "null" },
        {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["patterns", "severity"],
            properties: {
              patterns: {
                type: "array",
                minItems: 1,
                items: { type: "string", minLength: 1 },
              },
              severity: { enum: ["critical", "high", "medium", "low", "info"] },
            },
          },
        },
      ],
    },
    // Phase 8.2 D-01: per-rule auto-fix metadata. Discriminated union mirrors the matcher: shape.
    // D-15 cross-field rule (codegen-null-when-manual-only) is enforced post-Ajv in validateRuleDocument.
    fix: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["safety", "description", "codegen"],
          properties: {
            safety: { enum: ["safe", "unsafe", "manual-only"] },
            description: { type: "string", minLength: 1 },
            codegen: {
              anyOf: [{ type: "null" }, { type: "string", minLength: 1 }],
            },
          },
        },
      ],
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const validate: ValidateFunction<ParsedRuleDocument> = ajv.compile(SCHEMA);

export function validateRuleDocument(input: unknown): ParsedRuleDocument {
  const ok = validate(input);
  if (!ok) {
    const errs = (validate.errors ?? [])
      .map((e) => `${e.instancePath} ${e.message ?? ""}`)
      .join("; ");
    throw new Error(`invalid rule document: ${errs}`);
  }
  // path_severity_overrides is optional in YAML; normalize undefined → null so downstream code
  // can rely on a closed two-state value (D-57). Same normalization applied to `fix` per
  // Phase 8.2 D-04 — RuleSet consumers can rely on `fix !== undefined` (either FixMetadata or null).
  const raw = input as ParsedRuleDocument & {
    path_severity_overrides?: unknown;
    fix?: unknown;
  };
  const doc: ParsedRuleDocument = {
    ...(raw as ParsedRuleDocument),
    path_severity_overrides:
      raw.path_severity_overrides === undefined
        ? null
        : (raw.path_severity_overrides as ParsedRuleDocument["path_severity_overrides"]),
    fix: raw.fix === undefined ? null : (raw.fix as ParsedRuleDocument["fix"]),
  };
  // A rule must have at least one of matcher or predicate.
  if (doc.matcher === null && (doc.predicate === null || doc.predicate === "")) {
    throw new Error(`rule ${doc.rule_id}: must declare either 'matcher' or 'predicate'`);
  }
  // Phase 8.2 D-15: cross-field check on fix.safety vs fix.codegen.
  // safety == "manual-only" → codegen MUST be null.
  // safety in ("safe","unsafe") → codegen MUST be a non-empty string.
  if (doc.fix !== null && doc.fix !== undefined) {
    if (doc.fix.safety === "manual-only" && doc.fix.codegen !== null) {
      throw new Error(
        `rule ${doc.rule_id}: fix.codegen MUST be null when fix.safety is manual-only (D-15)`,
      );
    }
    if (
      (doc.fix.safety === "safe" || doc.fix.safety === "unsafe") &&
      doc.fix.codegen === null
    ) {
      throw new Error(
        `rule ${doc.rule_id}: fix.codegen MUST be a non-empty string when fix.safety is safe or unsafe (D-15)`,
      );
    }
  }
  return doc;
}
