import { describe, expect, it } from "vitest";
import {
  computeFindingId,
  computeHandlerId,
  computePrimaryLocationLineHash,
} from "../../src/findings/fingerprint.js";

describe("computePrimaryLocationLineHash", () => {
  it("returns a 64-char lowercase hex sha256", async () => {
    const hash = await computePrimaryLocationLineHash({
      rule_id: "stripe/missing-verification",
      file_path: "src/webhooks/stripe.ts",
      node_kind: "CallExpression",
      line_text: "  app.post('/webhooks/stripe', handler)",
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores whitespace differences (cosmetic reformatting does not change identity)", async () => {
    const a = await computePrimaryLocationLineHash({
      rule_id: "stripe/missing-verification",
      file_path: "src/webhooks/stripe.ts",
      node_kind: "CallExpression",
      line_text: "app.post('/webhooks/stripe', handler)",
    });
    const b = await computePrimaryLocationLineHash({
      rule_id: "stripe/missing-verification",
      file_path: "src/webhooks/stripe.ts",
      node_kind: "CallExpression",
      line_text: "    app.post('/webhooks/stripe',     handler)",
    });
    expect(a).toBe(b);
  });

  it("changes on real edits (different line text)", async () => {
    const a = await computePrimaryLocationLineHash({
      rule_id: "stripe/missing-verification",
      file_path: "src/webhooks/stripe.ts",
      node_kind: "CallExpression",
      line_text: "app.post('/webhooks/stripe', handler)",
    });
    const b = await computePrimaryLocationLineHash({
      rule_id: "stripe/missing-verification",
      file_path: "src/webhooks/stripe.ts",
      node_kind: "CallExpression",
      line_text: "app.post('/webhooks/github', handler)",
    });
    expect(a).not.toBe(b);
  });

  it("changes when rule_id changes (rule edits do produce new fingerprints)", async () => {
    const a = await computePrimaryLocationLineHash({
      rule_id: "stripe/missing-verification",
      file_path: "f.ts",
      node_kind: "CallExpression",
      line_text: "x()",
    });
    const b = await computePrimaryLocationLineHash({
      rule_id: "stripe/timing-unsafe-compare",
      file_path: "f.ts",
      node_kind: "CallExpression",
      line_text: "x()",
    });
    expect(a).not.toBe(b);
  });
});

describe("computeHandlerId — D-37 composite stable id", () => {
  it("is identical across calls with the same inputs (CLI/SaaS reproducibility)", async () => {
    const a = await computeHandlerId({
      file_path: "src/webhooks/stripe.ts",
      route_pattern: "/webhooks/stripe",
      http_methods: ["POST"],
      handler_function_name: "handleStripe",
    });
    const b = await computeHandlerId({
      file_path: "src/webhooks/stripe.ts",
      route_pattern: "/webhooks/stripe",
      http_methods: ["POST"],
      handler_function_name: "handleStripe",
    });
    expect(a).toBe(b);
  });

  it("normalizes http_methods (sort + uppercase) so order does not matter", async () => {
    const a = await computeHandlerId({
      file_path: "f.ts",
      route_pattern: "/x",
      http_methods: ["POST", "GET"],
      handler_function_name: null,
    });
    const b = await computeHandlerId({
      file_path: "f.ts",
      route_pattern: "/x",
      http_methods: ["get", "post"],
      handler_function_name: null,
    });
    expect(a).toBe(b);
  });

  it("treats null handler_function_name as <anonymous>", async () => {
    const a = await computeHandlerId({
      file_path: "f.ts",
      route_pattern: "/x",
      http_methods: ["POST"],
      handler_function_name: null,
    });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("breaks on file rename, route rename, fn rename (intentional per D-37)", async () => {
    const base = {
      file_path: "f.ts",
      route_pattern: "/x",
      http_methods: ["POST"],
      handler_function_name: "h",
    };
    const renamedFile = await computeHandlerId({ ...base, file_path: "g.ts" });
    const renamedRoute = await computeHandlerId({ ...base, route_pattern: "/y" });
    const renamedFn = await computeHandlerId({ ...base, handler_function_name: "h2" });
    const baseId = await computeHandlerId(base);
    expect(renamedFile).not.toBe(baseId);
    expect(renamedRoute).not.toBe(baseId);
    expect(renamedFn).not.toBe(baseId);
  });
});

describe("computeFindingId", () => {
  it("is deterministic and 64-char hex", async () => {
    const id = await computeFindingId({
      rule_id: "stripe/missing-verification",
      handler_id: "abc",
      file_path: "f.ts",
      primary_location_line_hash: "deadbeef",
    });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats null handler_id as <no-handler> (parse-error case)", async () => {
    const a = await computeFindingId({
      rule_id: "engine/parse-error",
      handler_id: null,
      file_path: "f.ts",
      primary_location_line_hash: "deadbeef",
    });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
