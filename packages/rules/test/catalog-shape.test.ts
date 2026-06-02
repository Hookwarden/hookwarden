import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderCatalogEntry } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/catalog.js";

// Phase 8.5 (SC#4) — runtime guard mirroring the ASYMMETRIC_PROVIDERS contract on
// ProviderCatalogEntry. The catalog is a static TS object (type-enforced at build), but tests are
// not tsc-checked (rules tsconfig includes src/ only), so a runtime guard is the executable
// negative-test surface per [[feedback_negative_tests_required]]. Returns true iff the asymmetric
// fields are well-formed: signature_scheme ∈ {hmac, ed25519} when present; asymmetric_verify_calls a
// string[] when present; public_key_encoding ∈ {hex, base64} when present.
function asymmetricFieldsWellFormed(entry: Record<string, unknown>): boolean {
  if (
    "signature_scheme" in entry &&
    !["hmac", "ed25519"].includes(entry.signature_scheme as string)
  )
    return false;
  if (
    "asymmetric_verify_calls" in entry &&
    !(
      Array.isArray(entry.asymmetric_verify_calls) &&
      entry.asymmetric_verify_calls.every((v) => typeof v === "string")
    )
  )
    return false;
  if (
    "public_key_encoding" in entry &&
    !["hex", "base64"].includes(entry.public_key_encoding as string)
  )
    return false;
  return true;
}

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

  it("hmac_algorithm is one of the D-91 union members (sha1 | sha256 | sha512)", () => {
    for (const provider of Object.keys(PROVIDER_CATALOG)) {
      const entry = PROVIDER_CATALOG[provider];
      expect(["sha1", "sha256", "sha512"]).toContain(entry?.hmac_algorithm);
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

describe("PROVIDER_CATALOG Phase 8.5 ASYMMETRIC_PROVIDERS branch (SC#4)", () => {
  // A complete HMAC entry with NO signature_scheme — proves the default-hmac / backward-compat path.
  const hmacEntry: ProviderCatalogEntry = {
    signature_header: ["x-sig"],
    sdk_packages: [],
    sdk_verify_calls: [],
    secret_env_prefix: ["ACME_WEBHOOK"],
    secret_literal_prefix: [],
    conventional_paths: ["/webhooks/acme"],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [],
  };

  // An asymmetric (Ed25519) entry — the Discord-shaped case Plan 05 will populate.
  const asymmetricEntry: ProviderCatalogEntry = {
    ...hmacEntry,
    conventional_paths: ["/api/discord/interactions"],
    signature_scheme: "ed25519",
    asymmetric_verify_calls: ["verifyKey", "nacl.sign.detached.verify"],
    public_key_encoding: "hex",
  };

  it("validates an HMAC entry with signature_scheme ABSENT (default-hmac backward compat)", () => {
    expect(hmacEntry.signature_scheme).toBeUndefined();
    expect(asymmetricFieldsWellFormed(hmacEntry)).toBe(true);
  });

  it("validates an Ed25519 entry with the asymmetric branch populated", () => {
    expect(asymmetricEntry.signature_scheme).toBe("ed25519");
    expect(asymmetricEntry.asymmetric_verify_calls).toContain("verifyKey");
    expect(asymmetricEntry.public_key_encoding).toBe("hex");
    expect(asymmetricFieldsWellFormed(asymmetricEntry)).toBe(true);
  });

  // NEGATIVE (SOC2 evidence): malformed asymmetric metadata must be rejected, not silently accepted.
  it("rejects an out-of-enum signature_scheme", () => {
    expect(asymmetricFieldsWellFormed({ ...hmacEntry, signature_scheme: "rsa" })).toBe(false);
  });

  it("rejects asymmetric_verify_calls supplied as a bare string instead of string[]", () => {
    expect(
      asymmetricFieldsWellFormed({ ...asymmetricEntry, asymmetric_verify_calls: "verifyKey" }),
    ).toBe(false);
  });

  it("rejects an out-of-enum public_key_encoding", () => {
    expect(asymmetricFieldsWellFormed({ ...asymmetricEntry, public_key_encoding: "der" })).toBe(
      false,
    );
  });

  // No-regression guarantee for SC#4: every entry is well-formed; scheme is hmac (absent⇒hmac) for
  // all HMAC providers, and the only asymmetric (ed25519) entry is the declared one (discord). Guards
  // against an HMAC provider being accidentally flipped to ed25519 (Phase 8.5 added discord).
  it("every catalog entry is well-formed; only declared asymmetric providers are ed25519", () => {
    const asymmetric: string[] = [];
    for (const provider of Object.keys(PROVIDER_CATALOG)) {
      const entry = PROVIDER_CATALOG[provider] as ProviderCatalogEntry;
      expect(asymmetricFieldsWellFormed(entry as unknown as Record<string, unknown>)).toBe(true);
      if ((entry.signature_scheme ?? "hmac") === "ed25519") asymmetric.push(provider);
    }
    expect(asymmetric.sort()).toEqual(["discord"]);
  });
});
