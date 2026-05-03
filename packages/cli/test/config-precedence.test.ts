import { describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, resolveConfig } from "../src/config/precedence.js";
import type { ParsedConfigDocument } from "../src/config/schema.js";

const noEnv = {} as NodeJS.ProcessEnv;

describe("resolveConfig", () => {
  it("returns documented defaults when nothing is set", () => {
    expect(resolveConfig({}, noEnv, null)).toEqual(CONFIG_DEFAULTS);
    expect(CONFIG_DEFAULTS).toEqual({
      fail_on: "high",
      format: "text",
      parse_coverage_min: 0.95,
      suppressions_strict: false,
      baseline_enabled: true,
      baseline_path: ".hookwarden.baseline.json",
      diff_base: null,
      rules_dir: null,
    });
  });

  it("file overrides default", () => {
    const file: ParsedConfigDocument = { schema_version: "1.0", fail_on: "critical" };
    expect(resolveConfig({}, noEnv, file).fail_on).toBe("critical");
  });

  it("env overrides file", () => {
    const file: ParsedConfigDocument = { schema_version: "1.0", fail_on: "low" };
    const env = { HOOKWARDEN_FAIL_ON: "critical" } as NodeJS.ProcessEnv;
    expect(resolveConfig({}, env, file).fail_on).toBe("critical");
  });

  it("CLI overrides env", () => {
    const env = { HOOKWARDEN_FAIL_ON: "low" } as NodeJS.ProcessEnv;
    expect(resolveConfig({ fail_on: "high" }, env, null).fail_on).toBe("high");
  });

  it("parses HOOKWARDEN_BASELINE_ENABLED across truthy/falsy spellings", () => {
    const cases: Array<[string, boolean]> = [
      ["false", false],
      ["true", true],
      ["1", true],
      ["0", false],
      ["yes", true],
      ["NO", false],
    ];
    for (const [raw, expected] of cases) {
      const env = { HOOKWARDEN_BASELINE_ENABLED: raw } as NodeJS.ProcessEnv;
      expect(resolveConfig({}, env, null).baseline_enabled).toBe(expected);
    }
  });

  it("parses HOOKWARDEN_PARSE_COVERAGE_MIN as a number; throws on non-numeric", () => {
    const ok = { HOOKWARDEN_PARSE_COVERAGE_MIN: "0.9" } as NodeJS.ProcessEnv;
    expect(resolveConfig({}, ok, null).parse_coverage_min).toBe(0.9);
    const bad = { HOOKWARDEN_PARSE_COVERAGE_MIN: "invalid" } as NodeJS.ProcessEnv;
    expect(() => resolveConfig({}, bad, null)).toThrow(/HOOKWARDEN_PARSE_COVERAGE_MIN/);
  });

  it("parses HOOKWARDEN_FORMAT against the allowed set", () => {
    const ok = { HOOKWARDEN_FORMAT: "json" } as NodeJS.ProcessEnv;
    expect(resolveConfig({}, ok, null).format).toBe("json");
    const bad = { HOOKWARDEN_FORMAT: "banana" } as NodeJS.ProcessEnv;
    expect(() => resolveConfig({}, bad, null)).toThrow(/format/i);
  });

  it("HOOKWARDEN_DIFF_BASE flows through as a string", () => {
    const env = { HOOKWARDEN_DIFF_BASE: "origin/main" } as NodeJS.ProcessEnv;
    expect(resolveConfig({}, env, null).diff_base).toBe("origin/main");
  });

  it("nested config keys flatten correctly into ResolvedConfig", () => {
    const file: ParsedConfigDocument = {
      schema_version: "1.0",
      baseline: { enabled: false, path: "custom.json" },
    };
    const result = resolveConfig({}, noEnv, file);
    expect(result.baseline_enabled).toBe(false);
    expect(result.baseline_path).toBe("custom.json");
  });
});
