// D-75 precedence: CLI > HOOKWARDEN_<KEY> env > hookwarden.config.yaml > built-in default.

import type { Severity } from "@hookwarden/engine";
import type { ParsedConfigDocument } from "./schema.js";

export interface ResolvedConfig {
  readonly fail_on: Severity;
  readonly format: "text" | "json" | "sarif";
  readonly parse_coverage_min: number;
  readonly suppressions_strict: boolean;
  readonly baseline_enabled: boolean;
  readonly baseline_path: string;
  readonly diff_base: string | null;
  readonly rules_dir: string | null;
  // When false (default), the walker excludes paths matching DEFAULT_TEST_GLOBS
  // (test/, tests/, __tests__/, spec/, fixtures/, mocks/, *.test.*, *.spec.*,
  // test_*.py, *_test.py). Production webhook routes almost never live in
  // these paths; their handlers are typically deliberately-broken fixtures
  // that dominate the findings list. Set to true via --include-tests (CLI)
  // or `scan_tests: true` (config) to also audit test code.
  readonly scan_tests: boolean;
}

export const CONFIG_DEFAULTS: ResolvedConfig = {
  fail_on: "high", // D-66: default threshold
  format: "text", // Phase 3 default
  parse_coverage_min: 0.95, // D-65
  suppressions_strict: false, // D-67 leniency by default
  baseline_enabled: true, // D-69 auto-read
  baseline_path: ".hookwarden.baseline.json",
  diff_base: null, // D-72 auto-detect
  rules_dir: null, // dev-only
  scan_tests: false, // exclude test paths by default; --include-tests opts back in
};

const SEVERITIES: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);
const FORMATS: ReadonlySet<string> = new Set(["text", "json", "sarif"]);

function parseBoolEnv(name: string, raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  throw new Error(`${name}: expected boolean (0|1|true|false|yes|no), got "${raw}"`);
}

function parseSeverityEnv(name: string, raw: string): Severity {
  if (!SEVERITIES.has(raw)) {
    throw new Error(`${name}: expected one of critical|high|medium|low, got "${raw}"`);
  }
  return raw as Severity;
}

function parseFormatEnv(name: string, raw: string): "text" | "json" | "sarif" {
  if (!FORMATS.has(raw)) {
    throw new Error(`${name}: expected one of text|json|sarif, got "${raw}"`);
  }
  return raw as "text" | "json" | "sarif";
}

function parseNumberEnv(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name}: expected number, got "${raw}"`);
  }
  return n;
}

export function resolveConfig(
  cliFlags: Partial<ResolvedConfig>,
  env: NodeJS.ProcessEnv,
  fileConfig: ParsedConfigDocument | null,
): ResolvedConfig {
  const pick = <T>(c: T | undefined, e: T | undefined, f: T | undefined, d: T): T => {
    if (c !== undefined) return c;
    if (e !== undefined) return e;
    if (f !== undefined) return f;
    return d;
  };

  const rawFailOn = env["HOOKWARDEN_FAIL_ON"];
  const rawFormat = env["HOOKWARDEN_FORMAT"];
  const rawParseCovMin = env["HOOKWARDEN_PARSE_COVERAGE_MIN"];
  const rawSuppressionsStrict = env["HOOKWARDEN_SUPPRESSIONS_STRICT"];
  const rawBaselineEnabled = env["HOOKWARDEN_BASELINE_ENABLED"];
  const envBaselinePath = env["HOOKWARDEN_BASELINE_PATH"];
  const envDiffBase = env["HOOKWARDEN_DIFF_BASE"];
  const envRulesDir = env["HOOKWARDEN_RULES_DIR"];
  const rawScanTests = env["HOOKWARDEN_SCAN_TESTS"];

  const envFailOn = rawFailOn ? parseSeverityEnv("HOOKWARDEN_FAIL_ON", rawFailOn) : undefined;
  const envFormat = rawFormat ? parseFormatEnv("HOOKWARDEN_FORMAT", rawFormat) : undefined;
  const envParseCovMin = rawParseCovMin
    ? parseNumberEnv("HOOKWARDEN_PARSE_COVERAGE_MIN", rawParseCovMin)
    : undefined;
  const envSuppressionsStrict = rawSuppressionsStrict
    ? parseBoolEnv("HOOKWARDEN_SUPPRESSIONS_STRICT", rawSuppressionsStrict)
    : undefined;
  const envBaselineEnabled = rawBaselineEnabled
    ? parseBoolEnv("HOOKWARDEN_BASELINE_ENABLED", rawBaselineEnabled)
    : undefined;
  const envScanTests = rawScanTests
    ? parseBoolEnv("HOOKWARDEN_SCAN_TESTS", rawScanTests)
    : undefined;

  return {
    fail_on: pick(cliFlags.fail_on, envFailOn, fileConfig?.fail_on, CONFIG_DEFAULTS.fail_on),
    format: pick(cliFlags.format, envFormat, fileConfig?.format, CONFIG_DEFAULTS.format),
    parse_coverage_min: pick(
      cliFlags.parse_coverage_min,
      envParseCovMin,
      fileConfig?.parse_coverage?.min,
      CONFIG_DEFAULTS.parse_coverage_min,
    ),
    suppressions_strict: pick(
      cliFlags.suppressions_strict,
      envSuppressionsStrict,
      fileConfig?.suppressions?.strict,
      CONFIG_DEFAULTS.suppressions_strict,
    ),
    baseline_enabled: pick(
      cliFlags.baseline_enabled,
      envBaselineEnabled,
      fileConfig?.baseline?.enabled,
      CONFIG_DEFAULTS.baseline_enabled,
    ),
    baseline_path: pick(
      cliFlags.baseline_path,
      envBaselinePath,
      fileConfig?.baseline?.path,
      CONFIG_DEFAULTS.baseline_path,
    ),
    diff_base: pick(
      cliFlags.diff_base,
      envDiffBase ?? undefined,
      fileConfig?.diff?.base ?? undefined,
      CONFIG_DEFAULTS.diff_base,
    ),
    rules_dir: pick(
      cliFlags.rules_dir,
      envRulesDir ?? undefined,
      fileConfig?.rules_dir ?? undefined,
      CONFIG_DEFAULTS.rules_dir,
    ),
    scan_tests: pick(
      cliFlags.scan_tests,
      envScanTests,
      fileConfig?.scan_tests,
      CONFIG_DEFAULTS.scan_tests,
    ),
  };
}
