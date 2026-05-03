// D-75 hookwarden.config.yaml schema: strict-mode Ajv with permissive rules.* / providers.* for Phase 6+.
// Strict mode (additionalProperties:false on top-level) EXCEPT for reserved keys `rules` and
// `providers` which are permissively typed for Phase 6/9+ forward compatibility.

import { Ajv, type ValidateFunction } from "ajv";

const ajv = new Ajv({ allErrors: true, strict: true });

const SCHEMA = {
  $id: "hookwarden-config-v1",
  type: "object",
  additionalProperties: false,
  required: ["schema_version"],
  properties: {
    schema_version: { type: "string", const: "1.0" },
    fail_on: { enum: ["critical", "high", "medium", "low"] },
    format: { enum: ["text", "json", "sarif"] },
    parse_coverage: {
      type: "object",
      additionalProperties: false,
      properties: { min: { type: "number", minimum: 0, maximum: 1 } },
    },
    suppressions: {
      type: "object",
      additionalProperties: false,
      properties: { strict: { type: "boolean" } },
    },
    baseline: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        path: { type: "string" },
      },
    },
    diff: {
      type: "object",
      additionalProperties: false,
      properties: { base: { type: ["string", "null"] } },
    },
    rules_dir: { type: ["string", "null"] },
    rules: { type: "object" },
    providers: { type: "object" },
  },
} as const;

export interface ParsedConfigDocument {
  readonly schema_version: "1.0";
  readonly fail_on?: "critical" | "high" | "medium" | "low";
  readonly format?: "text" | "json" | "sarif";
  readonly parse_coverage?: { readonly min?: number };
  readonly suppressions?: { readonly strict?: boolean };
  readonly baseline?: { readonly enabled?: boolean; readonly path?: string };
  readonly diff?: { readonly base?: string | null };
  readonly rules_dir?: string | null;
}

const validate: ValidateFunction = ajv.compile(SCHEMA);

export function validateConfigDocument(doc: unknown): ParsedConfigDocument {
  if (!validate(doc)) {
    const errs = (validate.errors ?? [])
      .map((e) => {
        const path = e.instancePath || "<root>";
        const key =
          e.params && "additionalProperty" in e.params
            ? ` (unknown key: ${(e.params as { additionalProperty: string }).additionalProperty})`
            : "";
        return `${path}: ${e.message}${key}`;
      })
      .join("; ");
    throw new Error(`hookwarden.config.yaml validation failed: ${errs}`);
  }
  return doc as ParsedConfigDocument;
}

export const CONFIG_SCHEMA_JSON = SCHEMA;
