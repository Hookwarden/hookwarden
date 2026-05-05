import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(here, "..", "rules");

function listRuleFiles(provider: string): string[] {
  try {
    return readdirSync(join(RULES_DIR, provider))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => f.replace(/\.yaml$/, ""));
  } catch {
    return [];
  }
}

describe("PROVIDER_CATALOG D-91 signing-recipe shape", () => {
  it("stripe entry has all 5 D-91 fields populated", () => {
    const stripe = PROVIDER_CATALOG.stripe;
    expect(stripe).toBeDefined();
    expect(stripe?.hmac_algorithm).toBe("sha256");
    expect(stripe?.signing_input_format).toBe("raw_body");
    expect(stripe?.timestamp_header).toBeNull();
    expect(stripe?.signature_encoding).toBe("hex");
    expect(stripe?.applicable_rules.length).toBeGreaterThan(0);
  });

  it("github entry has all 5 D-91 fields populated", () => {
    const github = PROVIDER_CATALOG.github;
    expect(github).toBeDefined();
    expect(github?.hmac_algorithm).toBe("sha256");
    expect(github?.signing_input_format).toBe("raw_body");
    expect(github?.timestamp_header).toBeNull();
    expect(github?.signature_encoding).toBe("hex");
    expect(github?.applicable_rules.length).toBeGreaterThan(0);
  });

  it("every catalog entry's applicable_rules corresponds to a YAML file under rules/<provider>/", () => {
    for (const provider of Object.keys(PROVIDER_CATALOG)) {
      const entry = PROVIDER_CATALOG[provider];
      const onDisk = new Set(listRuleFiles(provider));
      for (const ruleName of entry?.applicable_rules ?? []) {
        expect(
          onDisk.has(ruleName),
          `${provider}.applicable_rules has '${ruleName}' but no rules/${provider}/${ruleName}.yaml on disk`,
        ).toBe(true);
      }
    }
  });

  it("hmac_algorithm is always sha256 or sha512 (D-91 union)", () => {
    for (const provider of Object.keys(PROVIDER_CATALOG)) {
      const entry = PROVIDER_CATALOG[provider];
      expect(["sha256", "sha512"]).toContain(entry?.hmac_algorithm);
    }
  });

  it("signing_input_format is one of the 5 D-91 recipes", () => {
    const allowed = new Set([
      "raw_body",
      "timestamp_dot_body",
      "url_plus_sorted_params",
      "custom_field_tuple",
      "custom",
    ]);
    for (const provider of Object.keys(PROVIDER_CATALOG)) {
      const entry = PROVIDER_CATALOG[provider];
      expect(allowed.has(entry?.signing_input_format ?? "")).toBe(true);
    }
  });
});
