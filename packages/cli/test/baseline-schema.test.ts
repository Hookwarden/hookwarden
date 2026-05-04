import { describe, expect, it } from "vitest";
import { validateBaselineDocument } from "../src/baseline/schema.js";

const validDoc = {
  schema_version: "1.0",
  baselined_at: "2026-05-01T00:00:00.000Z",
  engine_version: "0.1.0",
  rule_pack_version: "0.1.0",
  rule_pack_content_hash: "sha256:abc123",
  findings: [
    {
      primary_location_line_hash: "h1",
      rule_id: "stripe/missing-verification",
      file_path: "src/webhook.ts",
      line: 42,
      severity_at_baseline: "high",
      state_at_baseline: "verified",
    },
  ],
} as const;

describe("validateBaselineDocument", () => {
  it("accepts a valid minimal document and returns it", () => {
    const minimal = { ...validDoc, findings: [] };
    expect(validateBaselineDocument(minimal)).toEqual(minimal);
  });

  it("rejects a document missing schema_version", () => {
    const { schema_version: _, ...bad } = validDoc;
    expect(() => validateBaselineDocument(bad)).toThrow(/schema_version/);
  });

  it("rejects rule_pack_content_hash without sha256: prefix", () => {
    const bad = { ...validDoc, rule_pack_content_hash: "abc123" };
    expect(() => validateBaselineDocument(bad)).toThrow(/rule_pack_content_hash/);
  });

  it("rejects unknown top-level keys (additionalProperties:false)", () => {
    const bad = { ...validDoc, unknown_key: 1 };
    expect(() => validateBaselineDocument(bad)).toThrow(/unknown_key/);
  });

  it("rejects a finding missing primary_location_line_hash", () => {
    const bad = {
      ...validDoc,
      findings: [
        {
          rule_id: "stripe/missing-verification",
          file_path: "src/webhook.ts",
          line: 42,
          severity_at_baseline: "high",
          state_at_baseline: "verified",
        },
      ],
    };
    expect(() => validateBaselineDocument(bad)).toThrow(/primary_location_line_hash/);
  });
});
