import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/catalog.js";
import { computeContentHash, loadRuleSet } from "../src/loader.js";
import { ALL_PREDICATES } from "../src/predicates/index.js";

const VALID_DOC = {
  schema_version: 1,
  rule_id: "github/missing-timing-safe-equal",
  provider: "github",
  severity: "critical",
  emits_state: "not-verified",
  message: "missing verification",
  matcher: null,
  predicate: "github-timing-safe-equal",
  applies_to: ["express", "hono"],
} as const;

describe("loadRuleSet (D-03 + ENGINE-08 content hash)", () => {
  it("loads a valid rule into a RuleSet shape", async () => {
    const rs = await loadRuleSet({
      rule_documents: [VALID_DOC],
      predicates: ALL_PREDICATES,
      providers: PROVIDER_CATALOG,
      rule_pack_version: "0.0.1",
    });
    expect(rs.schema_version).toBe(1);
    expect(rs.rule_pack_version).toBe("0.0.1");
    expect(rs.rules).toHaveLength(1);
    expect(rs.rules[0]?.rule_id).toBe("github/missing-timing-safe-equal");
    expect(rs.providers["github"]).toBeDefined();
    expect(typeof rs.predicates["github-timing-safe-equal"]).toBe("function");
  });

  it("rejects unknown fields on a rule document (Ajv strict)", async () => {
    await expect(
      loadRuleSet({
        rule_documents: [{ ...VALID_DOC, surprise_field: 1 }],
        predicates: ALL_PREDICATES,
        providers: PROVIDER_CATALOG,
        rule_pack_version: "0.0.1",
      }),
    ).rejects.toThrow(/invalid rule document/);
  });

  it("rejects rule whose predicate name is not registered", async () => {
    await expect(
      loadRuleSet({
        rule_documents: [{ ...VALID_DOC, predicate: "does-not-exist" }],
        predicates: ALL_PREDICATES,
        providers: PROVIDER_CATALOG,
        rule_pack_version: "0.0.1",
      }),
    ).rejects.toThrow(/predicate 'does-not-exist' not registered/);
  });

  it("rejects rule whose provider is not in the catalog", async () => {
    await expect(
      loadRuleSet({
        rule_documents: [{ ...VALID_DOC, provider: "made-up" }],
        predicates: ALL_PREDICATES,
        providers: PROVIDER_CATALOG,
        rule_pack_version: "0.0.1",
      }),
    ).rejects.toThrow(/provider 'made-up' missing from catalog/);
  });

  it("rejects rule with neither matcher nor predicate", async () => {
    await expect(
      loadRuleSet({
        rule_documents: [{ ...VALID_DOC, matcher: null, predicate: null }],
        predicates: ALL_PREDICATES,
        providers: PROVIDER_CATALOG,
        rule_pack_version: "0.0.1",
      }),
    ).rejects.toThrow(/must declare either 'matcher' or 'predicate'/);
  });

  it("loads each declarative matcher variant via the discriminated-union switch", async () => {
    const variants = [
      { name: "importMissing", args: { module: "stripe" } },
      { name: "callMatches", args: { qualified_name: "stripe.webhooks.constructEvent" } },
      { name: "argumentEquals", args: { call: "verify", arg_index: 0, equals: "x" } },
      { name: "middlewareOrder", args: { before: "verifyStripe", after: "express.json" } },
      { name: "secretLiteralPrefix", args: { prefix: "whsec_" } },
      { name: "signatureHeaderRead", args: { header: "stripe-signature" } },
    ] as const;
    const docs = variants.map((m, i) => ({
      ...VALID_DOC,
      rule_id: `stripe/variant-${i}`,
      provider: "stripe",
      matcher: m,
      predicate: null,
    }));
    const rs = await loadRuleSet({
      rule_documents: docs,
      predicates: ALL_PREDICATES,
      providers: PROVIDER_CATALOG,
      rule_pack_version: "0.0.1",
    });
    expect(rs.rules).toHaveLength(variants.length);
    for (let i = 0; i < variants.length; i++) {
      expect(rs.rules[i]?.matcher?.name).toBe(variants[i]?.name);
    }
  });
});

describe("computeContentHash (ENGINE-08, D-38)", () => {
  it("returns a 64-char hex sha256", async () => {
    const hash = await computeContentHash(PROVIDER_CATALOG, [VALID_DOC]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", async () => {
    const a = await computeContentHash(PROVIDER_CATALOG, [VALID_DOC]);
    const b = await computeContentHash(PROVIDER_CATALOG, [VALID_DOC]);
    expect(a).toBe(b);
  });

  it("changes when a rule changes", async () => {
    const a = await computeContentHash(PROVIDER_CATALOG, [VALID_DOC]);
    const b = await computeContentHash(PROVIDER_CATALOG, [{ ...VALID_DOC, severity: "high" }]);
    expect(a).not.toBe(b);
  });

  it("changes when the catalog changes", async () => {
    const a = await computeContentHash(PROVIDER_CATALOG, [VALID_DOC]);
    const stripeEntry = PROVIDER_CATALOG["stripe"] ?? {
      signature_header: [],
      sdk_packages: [],
      sdk_verify_calls: [],
      secret_env_prefix: [],
      secret_literal_prefix: [],
      conventional_paths: [],
    };
    const tweaked = {
      ...PROVIDER_CATALOG,
      stripe: {
        ...stripeEntry,
        signature_header: ["stripe-signature", "x-stripe-signature"],
      },
    };
    const b = await computeContentHash(tweaked, [VALID_DOC]);
    expect(a).not.toBe(b);
  });
});

describe("smoke-test rule predicate (github-timing-safe-equal)", () => {
  type PredicateInput = Parameters<(typeof ALL_PREDICATES)["github-timing-safe-equal"]>[0];

  it("returns 'verified' when crypto.timingSafeEqual is reachable", async () => {
    const handler = {
      provider: "github",
      reachable_symbols: [
        {
          qualified_name: "crypto.timingSafeEqual",
          import_source: "node:crypto",
          hops: 1,
          via: "direct call",
        },
      ],
    } as unknown as PredicateInput;
    const verdict = await ALL_PREDICATES["github-timing-safe-equal"]!(handler, {} as never);
    expect(verdict).toBe("verified");
  });

  it("returns 'not-verified' when no verification is reachable", async () => {
    const handler = {
      provider: "github",
      reachable_symbols: [],
    } as unknown as PredicateInput;
    const verdict = await ALL_PREDICATES["github-timing-safe-equal"]!(handler, {} as never);
    expect(verdict).toBe("not-verified");
  });

  it("returns null for non-github handlers (rule does not apply)", async () => {
    const handler = {
      provider: "stripe",
      reachable_symbols: [],
    } as unknown as PredicateInput;
    const verdict = await ALL_PREDICATES["github-timing-safe-equal"]!(handler, {} as never);
    expect(verdict).toBeNull();
  });
});
