// D-68 baseline schema: fingerprint-only, sorted by hash for diff stability.
// Strict-mode Ajv (additionalProperties:false on every nested object) — same pattern as
// packages/rules/src/schema.ts and packages/cli/src/config/schema.ts.

import { Ajv, type ValidateFunction } from "ajv";
import type { Severity, Verdict } from "@hookwarden/engine";

const ajv = new Ajv({ allErrors: true, strict: true });

const SCHEMA = {
  $id: "hookwarden-baseline-v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "baselined_at",
    "engine_version",
    "rule_pack_version",
    "rule_pack_content_hash",
    "findings",
  ],
  properties: {
    schema_version: { type: "string", const: "1.0" },
    baselined_at: { type: "string", minLength: 1 },
    engine_version: { type: "string", minLength: 1 },
    rule_pack_version: { type: "string", minLength: 1 },
    rule_pack_content_hash: { type: "string", pattern: "^sha256:[0-9a-f]+$" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "primary_location_line_hash",
          "rule_id",
          "file_path",
          "line",
          "severity_at_baseline",
          "state_at_baseline",
        ],
        properties: {
          primary_location_line_hash: { type: "string", minLength: 1 },
          rule_id: { type: "string", minLength: 1 },
          file_path: { type: "string", minLength: 1 },
          line: { type: "integer", minimum: 1 },
          severity_at_baseline: {
            enum: ["critical", "high", "medium", "low", "info"],
          },
          state_at_baseline: {
            enum: ["verified", "not-verified", "manual-review"],
          },
        },
      },
    },
  },
} as const;

export interface BaselinedFinding {
  readonly primary_location_line_hash: string;
  readonly rule_id: string;
  readonly file_path: string;
  readonly line: number;
  readonly severity_at_baseline: Severity;
  readonly state_at_baseline: Verdict;
}

export interface BaselineDocument {
  readonly schema_version: "1.0";
  readonly baselined_at: string;
  readonly engine_version: string;
  readonly rule_pack_version: string;
  readonly rule_pack_content_hash: string;
  readonly findings: ReadonlyArray<BaselinedFinding>;
}

const validate: ValidateFunction = ajv.compile(SCHEMA);

export function validateBaselineDocument(doc: unknown): BaselineDocument {
  if (!validate(doc)) {
    const errs = (validate.errors ?? [])
      .map((e) => {
        const path = e.instancePath || "<root>";
        const key =
          e.params && "additionalProperty" in e.params
            ? ` (unknown key: ${(e.params as { additionalProperty: string }).additionalProperty})`
            : "";
        const missing =
          e.params && "missingProperty" in e.params
            ? ` (missing: ${(e.params as { missingProperty: string }).missingProperty})`
            : "";
        return `${path}: ${e.message ?? ""}${key}${missing}`;
      })
      .join("; ");
    throw new Error(`baseline document validation failed: ${errs}`);
  }
  return doc as BaselineDocument;
}

export const BASELINE_SCHEMA_JSON = SCHEMA;
