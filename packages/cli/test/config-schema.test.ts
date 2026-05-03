import { describe, expect, it } from "vitest";
import { CONFIG_SCHEMA_JSON, validateConfigDocument } from "../src/config/schema.js";

describe("validateConfigDocument", () => {
  it("accepts a minimal valid document with only schema_version", () => {
    const doc = { schema_version: "1.0" } as const;
    expect(validateConfigDocument(doc)).toEqual(doc);
  });

  it("accepts fail_on with a valid severity", () => {
    const doc = { schema_version: "1.0", fail_on: "high" } as const;
    expect(validateConfigDocument(doc)).toEqual(doc);
  });

  it("rejects unknown top-level keys with the offending key in the error", () => {
    const doc = { schema_version: "1.0", unknown_key: 1 };
    expect(() => validateConfigDocument(doc)).toThrow(/unknown_key/);
  });

  it("rejects fail_on with an unknown severity", () => {
    const doc = { schema_version: "1.0", fail_on: "extreme" };
    expect(() => validateConfigDocument(doc)).toThrow(/fail_on/);
  });

  it("rejects parse_coverage.min outside the 0..1 range", () => {
    const doc = { schema_version: "1.0", parse_coverage: { min: 1.5 } };
    expect(() => validateConfigDocument(doc)).toThrow();
  });

  it("permissively accepts the reserved `rules` key for Phase 6+ forward compat", () => {
    const doc = { schema_version: "1.0", rules: { version: "1.4.2" } };
    expect(validateConfigDocument(doc)).toEqual(doc);
  });

  it("permissively accepts the reserved `providers` key for Phase 9+", () => {
    const doc = {
      schema_version: "1.0",
      providers: { stripe: { api_version: "2024-04" } },
    };
    expect(validateConfigDocument(doc)).toEqual(doc);
  });

  it("rejects a document missing the required schema_version", () => {
    expect(() => validateConfigDocument({})).toThrow();
  });

  it("rejects schema_version values other than '1.0'", () => {
    expect(() => validateConfigDocument({ schema_version: "0.9" })).toThrow();
  });

  it("publishes the JSON schema as a named export tagged with the v1 $id", () => {
    expect(CONFIG_SCHEMA_JSON.$id).toBe("hookwarden-config-v1");
    expect(CONFIG_SCHEMA_JSON.additionalProperties).toBe(false);
  });
});
