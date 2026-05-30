// Unit tests for the CFG-lite overlay (model/handler-cfg.ts). Tests the
// emission contract directly with hand-built handler bodies + a synthetic
// ProviderCatalog row. The end-to-end integration via assembleHandler is
// exercised by the existing build.ts test suite once VAS-01 lands its
// canonical fixtures in Phase 14.

import type {
  ArrowFunctionExpression,
  ExpressionStatement,
  FunctionDeclaration,
} from "@babel/types";
import { describe, expect, it } from "vitest";
import { collectVerifyOrderingEvidence } from "../../src/model/handler-cfg.js";
import { parseJsTs } from "../../src/parsers/babel.js";
import type { ProviderCatalog } from "../../src/types/rule-set.js";

const STRIPE_WITH_SINKS: ProviderCatalog = {
  stripe: {
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe"],
    sdk_verify_calls: ["webhooks.constructEvent"],
    secret_env_prefix: ["STRIPE_WEBHOOK"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: ["/webhooks/stripe"],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: "stripe-signature",
    signature_encoding: "hex",
    applicable_rules: ["missing-signature-verification"],
    db_sink_calls: ["prisma.user.create", "prisma.event.create"],
    http_sink_calls: ["fetch", "axios.post"],
    event_sink_calls: ["emitter.emit"],
    notification_sink_calls: ["nodemailer.sendMail"],
  },
};

const LOCATION = { file_path: "test.ts", line: 1, column: 1 } as const;

async function arrowBody(source: string): Promise<ArrowFunctionExpression["body"]> {
  // Wrap the source in an exported arrow expression so the first program-body
  // statement is the arrow's body.
  const wrapped = `const _handler = async (req, res) => { ${source} };`;
  const file = await parseJsTs({ file_path: "test.ts", source_text: wrapped });
  const program = (file.raw_ast as { program: { body: FunctionDeclaration[] } }).program;
  const decl = program.body[0] as unknown as {
    declarations: Array<{ init: ArrowFunctionExpression }>;
  };
  return decl.declarations[0].init.body;
}

describe("collectVerifyOrderingEvidence — canonical bug shape", () => {
  it("emits side_effect_before_verify when a DB write precedes verification", async () => {
    const body = await arrowBody(
      `await prisma.user.create({ data: { email: 'x@y.z' } });
       const event = stripe.webhooks.constructEvent(req.body, sig, secret);`,
    );
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      reachable_qnames: new Set(["stripe.webhooks.constructEvent"]),
    });
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.kind).toBe("side_effect_before_verify");
    expect(evidence[0]?.provider).toBe("stripe");
    expect(evidence[0]?.detail).toBe("prisma.user.create");
  });

  it("emits when an outbound HTTP fetch precedes verification", async () => {
    const body = await arrowBody(
      `await fetch('https://example.com/notify', { method: 'POST' });
       const event = stripe.webhooks.constructEvent(req.body, sig, secret);`,
    );
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      reachable_qnames: new Set(["stripe.webhooks.constructEvent"]),
    });
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.detail).toBe("fetch");
  });

  it("emits one evidence per side effect before verify (multiple sinks)", async () => {
    const body = await arrowBody(
      `await prisma.user.create({ data });
       emitter.emit('webhook.received', payload);
       const event = stripe.webhooks.constructEvent(req.body, sig, secret);`,
    );
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      reachable_qnames: new Set(["stripe.webhooks.constructEvent"]),
    });
    expect(evidence.length).toBe(2);
    expect(evidence.map((e) => e.detail).sort()).toEqual(["emitter.emit", "prisma.user.create"]);
  });
});

describe("collectVerifyOrderingEvidence — canonical good shape (no emit)", () => {
  it("emits NO evidence when verify is the first statement", async () => {
    const body = await arrowBody(
      `const event = stripe.webhooks.constructEvent(req.body, sig, secret);
       await prisma.user.create({ data });`,
    );
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      reachable_qnames: new Set(["stripe.webhooks.constructEvent"]),
    });
    expect(evidence.length).toBe(0);
  });

  it("emits NO evidence when only neutral statements precede verify", async () => {
    const body = await arrowBody(
      `console.log('received webhook');
       const u = await prisma.user.findUnique({ where: { id } });
       const event = stripe.webhooks.constructEvent(req.body, sig, secret);`,
    );
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      reachable_qnames: new Set(["stripe.webhooks.constructEvent"]),
    });
    expect(evidence.length).toBe(0);
  });

  it("emits NO evidence when handler body is empty", async () => {
    const body = await arrowBody("");
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      reachable_qnames: new Set(),
    });
    expect(evidence.length).toBe(0);
  });
});

describe("collectVerifyOrderingEvidence — non-applicable scopes (no emit)", () => {
  it("emits NO evidence when provider is 'unknown' (we never speculate provider)", async () => {
    const body = await arrowBody(
      `await prisma.user.create({ data });
       const event = stripe.webhooks.constructEvent(req.body, sig, secret);`,
    );
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "unknown",
      reachable_qnames: new Set(["stripe.webhooks.constructEvent"]),
    });
    expect(evidence.length).toBe(0);
  });

  it("emits NO evidence when provider is not in the catalog", async () => {
    const body = await arrowBody(
      `await prisma.user.create({ data });
       const event = stripe.webhooks.constructEvent(req.body, sig, secret);`,
    );
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "doesnt-exist",
      reachable_qnames: new Set(),
    });
    expect(evidence.length).toBe(0);
  });

  it("emits NO evidence for a non-JS handler_body_node (Python/PHP tree-sitter nodes)", () => {
    // Simulate a tree-sitter node — has a `type` field but not a Babel function shape.
    const phpNode = { type: "method_declaration", body: { type: "compound_statement" } };
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: phpNode,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      reachable_qnames: new Set(["stripe.webhooks.constructEvent"]),
    });
    expect(evidence.length).toBe(0);
  });

  it("emits NO evidence for an arrow with implicit return (no Block body)", async () => {
    // Arrow function with single-expression body — no top-level statements to walk.
    const wrapped = "const _handler = (x) => x + 1;";
    const file = await parseJsTs({ file_path: "test.ts", source_text: wrapped });
    const program = (file.raw_ast as { program: { body: ExpressionStatement[] } }).program;
    const decl = program.body[0] as unknown as {
      declarations: Array<{ init: ArrowFunctionExpression }>;
    };
    const arrow = decl.declarations[0].init;
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: arrow,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      reachable_qnames: new Set(),
    });
    expect(evidence.length).toBe(0);
  });
});

describe("collectVerifyOrderingEvidence — reachable-helper recognition", () => {
  it("treats a helper call as verification when its qname is in reachable_qnames", async () => {
    const body = await arrowBody(
      `verifyWebhook(req, sig);
       await prisma.user.create({ data });`,
    );
    const evidence = collectVerifyOrderingEvidence({
      handler_body_node: { type: "ArrowFunctionExpression", body, params: [] } as never,
      location: LOCATION,
      providerCatalog: STRIPE_WITH_SINKS,
      provider: "stripe",
      // verifyWebhook reaches webhooks.constructEvent via reachability — caller
      // pre-resolves and adds verifyWebhook to the qname set (the matching
      // suffix logic does the rest).
      reachable_qnames: new Set(["verifyWebhook.webhooks.constructEvent"]),
    });
    // verifyWebhook.webhooks.constructEvent ends with `.webhooks.constructEvent`
    // → counts as verification → no side_effect_before_verify on the later DB write.
    expect(evidence.length).toBe(0);
  });
});
