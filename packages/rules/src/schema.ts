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
}

const SCHEMA = {
  $id: "hookwarden-rule-document-v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "rule_id",
    "provider",
    "severity",
    "emits_state",
    "message",
    "applies_to",
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
            enum: ["express", "hono", "fastify", "nextjs", "flask", "fastapi", "django"],
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
  // A rule must have at least one of matcher or predicate.
  const doc = input as ParsedRuleDocument;
  if (doc.matcher === null && (doc.predicate === null || doc.predicate === "")) {
    throw new Error(`rule ${doc.rule_id}: must declare either 'matcher' or 'predicate'`);
  }
  return doc;
}
