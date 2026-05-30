import type { CallExpression, ExpressionStatement } from "@babel/types";
import { describe, expect, it } from "vitest";
import { classifySecretShape } from "../../src/evaluator/secret-identifier.js";
import { parseJsTs } from "../../src/parsers/babel.js";

async function firstCallArg(source: string): Promise<unknown> {
  const file = await parseJsTs({ file_path: "test.ts", source_text: `${source};` });
  const program = (file.raw_ast as { program: { body: ExpressionStatement[] } }).program;
  const expr = program.body[0]?.expression as CallExpression;
  return expr.arguments[0];
}

describe("classifySecretShape — fires (value leaked)", () => {
  it("fires on bare identifier reference", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(secret)")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("bare");
    expect(r.verdict).toBe("fires");
  });

  it("fires on template literal interpolation", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(`secret=${secret}`)")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("template");
    expect(r.verdict).toBe("fires");
  });

  it("fires on string concatenation", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log('secret=' + secret)")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("concat");
    expect(r.verdict).toBe("fires");
  });

  it("fires on .toString()", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("logger.error(secret.toString())")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("to-string");
    expect(r.verdict).toBe("fires");
  });

  it("fires on String(secret)", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("logger.error(String(secret))")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("to-string");
    expect(r.verdict).toBe("fires");
  });

  it("fires on JSON.stringify(secret)", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.error(JSON.stringify(secret))")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("json");
    expect(r.verdict).toBe("fires");
  });
});

describe("classifySecretShape — silent (defensible patterns)", () => {
  it("silent on !!secret", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(!!secret)")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("boolean");
    expect(r.verdict).toBe("silent");
  });

  it("silent on Boolean(secret)", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(Boolean(secret))")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("boolean");
    expect(r.verdict).toBe("silent");
  });

  it("silent on secret.length", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(secret.length)")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("length");
    expect(r.verdict).toBe("silent");
  });

  it("silent on sha256(secret)", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(sha256(secret))")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("hash");
    expect(r.verdict).toBe("silent");
  });

  it("silent on crypto.createHash().update(secret).digest()", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg(
        "console.log(createHash('sha256').update(secret).digest('hex'))",
      )) as never,
      secretName: "secret",
    });
    // The outer call's callee is a CallExpression chain ending in .digest; the
    // hash hint fires on the inner update(secret) reference. Verdict: silent.
    expect(r.verdict).toBe("silent");
  });

  it("silent when secret never appears", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log('hello world')")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("absent");
    expect(r.verdict).toBe("silent");
  });

  it("silent on log of a different identifier (provider attribution intact)", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(req.headers)")) as never,
      secretName: "WEBHOOK_SECRET",
    });
    expect(r.shape).toBe("absent");
    expect(r.verdict).toBe("silent");
  });
});

describe("classifySecretShape — manual-review (small partial reveal)", () => {
  it("manual-review on secret.slice(0, 4) — under default threshold", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(secret.slice(0, 4))")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("slice");
    expect(r.verdict).toBe("manual-review");
  });

  it("manual-review on secret.substring(0, 8) — at default threshold", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(secret.substring(0, 8))")) as never,
      secretName: "secret",
    });
    expect(r.verdict).toBe("manual-review");
  });

  it("fires on secret.slice(0, 16) — over default threshold (treated as bare)", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(secret.slice(0, 16))")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("bare");
    expect(r.verdict).toBe("fires");
  });

  it("respects custom safeSliceMax", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(secret.slice(0, 32))")) as never,
      secretName: "secret",
      safeSliceMax: 64,
    });
    expect(r.shape).toBe("slice");
    expect(r.verdict).toBe("manual-review");
  });
});

describe("classifySecretShape — negative / contract-violation tests", () => {
  it("does not fire on a same-named variable in a different scope (no resolution responsibility)", async () => {
    // The classifier is responsibility-bounded: identifier resolution is the
    // CALLER's job. If the caller passes "WEBHOOK_SECRET" but the expression
    // contains a different `secret` identifier, the classifier reports absent.
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(secret)")) as never,
      secretName: "WEBHOOK_SECRET",
    });
    expect(r.shape).toBe("absent");
    expect(r.verdict).toBe("silent");
  });

  it("fires on `${secret}` (template with only secret reference)", async () => {
    const r = classifySecretShape({
      expression: (await firstCallArg("console.log(`${secret}`)")) as never,
      secretName: "secret",
    });
    expect(r.shape).toBe("template");
    expect(r.verdict).toBe("fires");
  });
});
