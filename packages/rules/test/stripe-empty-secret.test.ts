// 08.3 Plan 17 — Stripe empty-secret bypass detector (CVE-2026-41432) tests.
//
// PARTIAL coverage shipping JS/TS variants 1 (||), 2 (??), 3 (ternary), 6 (explicit
// empty literal). Variants 4 (missing-guard) + 5 (optional-chain) + Python + PHP
// deferred to Plan 17b — see 08.3-17-SUMMARY.md §"Known-incomplete arms".
//
// Each variant has an INDEPENDENT positive test asserting the predicate fires AND
// classifies the match arm correctly. A regression that collapses variants would
// surface as the classifier returning the wrong variant tag.

import {
  type ParsedFile,
  type ProjectModel,
  type WebhookHandler,
  parseJsTs,
} from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import {
  __test_only,
  stripeEmptySecretPredicate,
} from "../src/predicates/stripe-empty-secret.js";

async function parse(source: string, filePath = "src/server.ts"): Promise<ParsedFile> {
  return parseJsTs({ source_text: source, file_path: filePath, hint: "ts" });
}

function makeHandler(file: ParsedFile): WebhookHandler {
  return {
    id: "h1",
    framework: "express",
    framework_version: null,
    route_pattern: "/webhooks/stripe",
    http_methods: ["POST"],
    file_path: file.file_path,
    location: { line: 1, col: 1, end_line: 1, end_col: 1 },
    handler_function_name: "stripeWebhook",
    provider: "stripe",
    verification_state: "manual-review",
    evidence: [],
    middleware_chain: [],
    reachable_symbols: [],
    findings_ref: [],
    redacted_snippet: "",
  };
}

function makeModel(file: ParsedFile): ProjectModel {
  return { parsed_files: [file] } as unknown as ProjectModel;
}

async function runOn(source: string) {
  const file = await parse(source);
  const handler = makeHandler(file);
  const model = makeModel(file);
  return stripeEmptySecretPredicate(handler, model);
}

describe("stripeEmptySecretPredicate — Variant 1: `secret || ''` (logical-OR fallback)", () => {
  it("emits not-verified when constructEvent receives `secret || ''`", async () => {
    const src = `
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      stripe.webhooks.constructEvent(rawBody, sig, secret || '');
    `;
    expect(await runOn(src)).toBe("not-verified");
  });
  it("classifies the variant as 'or-fallback'", async () => {
    const file = await parse("stripe.webhooks.constructEvent(b, s, secret || '');");
    const ast = (file.raw_ast as { program: import("../src/predicates/stripe-empty-secret.js").__test_only extends never ? never : { type: string } });
    const matches = __test_only.findEmptySecretConstructEventCalls(
      (file.raw_ast as { program: { type: string } }).program as never,
    );
    expect(matches.map((m) => m.variant)).toEqual(["or-fallback"]);
  });
});

describe("stripeEmptySecretPredicate — Variant 2: `secret ?? ''` (nullish-coalesce fallback)", () => {
  it("emits not-verified when constructEvent receives `secret ?? ''`", async () => {
    const src = `stripe.webhooks.constructEvent(rawBody, sig, secret ?? '');`;
    expect(await runOn(src)).toBe("not-verified");
  });
  it("classifies the variant as 'nullish-fallback'", async () => {
    const file = await parse("stripe.webhooks.constructEvent(b, s, secret ?? '');");
    const matches = __test_only.findEmptySecretConstructEventCalls(
      (file.raw_ast as { program: { type: string } }).program as never,
    );
    expect(matches.map((m) => m.variant)).toEqual(["nullish-fallback"]);
  });
});

describe("stripeEmptySecretPredicate — Variant 3: `cond ? x : ''` (ternary fallback)", () => {
  it("emits not-verified when constructEvent receives `secret ? secret : ''`", async () => {
    const src = `stripe.webhooks.constructEvent(rawBody, sig, secret ? secret : '');`;
    expect(await runOn(src)).toBe("not-verified");
  });
  it("emits not-verified on the inverse ternary `cond ? '' : x`", async () => {
    const src = `stripe.webhooks.constructEvent(rawBody, sig, secret ? '' : secret);`;
    expect(await runOn(src)).toBe("not-verified");
  });
  it("classifies the variant as 'ternary'", async () => {
    const file = await parse("stripe.webhooks.constructEvent(b, s, x ? x : '');");
    const matches = __test_only.findEmptySecretConstructEventCalls(
      (file.raw_ast as { program: { type: string } }).program as never,
    );
    expect(matches.map((m) => m.variant)).toEqual(["ternary"]);
  });
});

describe("stripeEmptySecretPredicate — Variant 6: explicit empty literal at the secret arg position", () => {
  it("emits not-verified when constructEvent receives the literal '' as secret", async () => {
    const src = `stripe.webhooks.constructEvent(rawBody, sig, '');`;
    expect(await runOn(src)).toBe("not-verified");
  });
  it("emits not-verified when constructEvent receives the literal \"\" as secret", async () => {
    const src = `stripe.webhooks.constructEvent(rawBody, sig, "");`;
    expect(await runOn(src)).toBe("not-verified");
  });
  it("emits not-verified when constructEvent receives a template-literal `` as secret", async () => {
    const src = "stripe.webhooks.constructEvent(rawBody, sig, ``);";
    expect(await runOn(src)).toBe("not-verified");
  });
  it("classifies the variant as 'explicit-empty-literal'", async () => {
    const file = await parse("stripe.webhooks.constructEvent(b, s, '');");
    const matches = __test_only.findEmptySecretConstructEventCalls(
      (file.raw_ast as { program: { type: string } }).program as never,
    );
    expect(matches.map((m) => m.variant)).toEqual(["explicit-empty-literal"]);
  });
  it("INDEPENDENCE: explicit empty literal does NOT classify as 'or-fallback'", async () => {
    const file = await parse("stripe.webhooks.constructEvent(b, s, '');");
    const matches = __test_only.findEmptySecretConstructEventCalls(
      (file.raw_ast as { program: { type: string } }).program as never,
    );
    expect(matches[0]?.variant).not.toBe("or-fallback");
    expect(matches[0]?.variant).not.toBe("nullish-fallback");
    expect(matches[0]?.variant).not.toBe("ternary");
  });
});

describe("stripeEmptySecretPredicate — verified handler (FP=0 negative)", () => {
  it("returns null when the secret is a non-empty literal", async () => {
    const src = `stripe.webhooks.constructEvent(rawBody, sig, 'whsec_test_real_secret');`;
    expect(await runOn(src)).toBeNull();
  });
  it("returns null when the handler validates the env var at boot then passes through", async () => {
    const src = `
      const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
      if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is required");
      stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    `;
    expect(await runOn(src)).toBeNull();
  });
  it("returns null when the secret is a Buffer / Uint8Array literal (non-empty bytes)", async () => {
    const src = `stripe.webhooks.constructEvent(rawBody, sig, Buffer.from('whsec_x'));`;
    expect(await runOn(src)).toBeNull();
  });
  it("returns null when the fallback is to a non-empty string", async () => {
    // `secret || 'fallback'` is wrong for other reasons (hardcoded secret) but is NOT the
    // empty-secret CVE. This rule must not false-flag here; the hardcoded-secret-prefix
    // rule catches the literal whsec_ pattern separately.
    const src = `stripe.webhooks.constructEvent(rawBody, sig, secret || 'whsec_fallback');`;
    expect(await runOn(src)).toBeNull();
  });
});

describe("stripeEmptySecretPredicate — provider scope + dialect dispatch", () => {
  it("returns null for a non-stripe handler (contract-violation: provider-scoped)", async () => {
    const file = await parse(`stripe.webhooks.constructEvent(rawBody, sig, '');`);
    const handler = { ...makeHandler(file), provider: "github" };
    const model = makeModel(file);
    expect(await stripeEmptySecretPredicate(handler, model)).toBeNull();
  });
  it("returns null when the parsed file's dialect is not babel (Python/PHP deferred to Plan 17b)", async () => {
    const file = await parse(`stripe.webhooks.constructEvent(rawBody, sig, '');`);
    const handler = makeHandler(file);
    // Adversary-shaped: spoof the dialect to assert the predicate gracefully defers.
    const spoofed: ParsedFile = { ...file, dialect: "tree-sitter-python" } as ParsedFile;
    const model = { parsed_files: [spoofed] } as unknown as ProjectModel;
    expect(await stripeEmptySecretPredicate(handler, model)).toBeNull();
  });
  it("returns null when no parsed file matches handler.file_path", async () => {
    const file = await parse(`stripe.webhooks.constructEvent(rawBody, sig, '');`);
    const handler = { ...makeHandler(file), file_path: "other.ts" };
    const model = makeModel(file);
    expect(await stripeEmptySecretPredicate(handler, model)).toBeNull();
  });
});

describe("stripeEmptySecretPredicate — defense in depth: multiple call sites", () => {
  it("fires when ANY constructEvent call site has an empty secret (even mixed with verified ones)", async () => {
    const src = `
      stripe.webhooks.constructEvent(rawBody1, sig1, REAL_SECRET);
      stripe.webhooks.constructEvent(rawBody2, sig2, '');
    `;
    expect(await runOn(src)).toBe("not-verified");
  });
  it("does NOT fire when all call sites use a non-empty secret", async () => {
    const src = `
      stripe.webhooks.constructEvent(rawBody1, sig1, REAL_SECRET_A);
      stripe.webhooks.constructEvent(rawBody2, sig2, REAL_SECRET_B);
    `;
    expect(await runOn(src)).toBeNull();
  });
});
