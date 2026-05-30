import type { ExpressionStatement, VariableDeclaration } from "@babel/types";
import { describe, expect, it } from "vitest";
import { foldNumericExpression } from "../../src/evaluator/constant-fold.js";
import { parseJsTs } from "../../src/parsers/babel.js";

async function parseExpr(source: string): Promise<unknown> {
  const file = await parseJsTs({ file_path: "test.ts", source_text: `const x = ${source};` });
  // raw_ast is the Babel File; first statement is the const decl; init is the expr.
  const program = (file.raw_ast as { program: { body: VariableDeclaration[] } }).program;
  const decl = program.body[0] as VariableDeclaration;
  return decl.declarations[0]?.init;
}

async function parseTopExpr(source: string): Promise<unknown> {
  const file = await parseJsTs({ file_path: "test.ts", source_text: `${source};` });
  const program = (file.raw_ast as { program: { body: ExpressionStatement[] } }).program;
  return program.body[0]?.expression;
}

describe("foldNumericExpression — happy path", () => {
  it("folds a single NumericLiteral", async () => {
    const ast = await parseExpr("300");
    const r = foldNumericExpression(ast);
    expect(r.value).toBe(300);
    expect(r.resolved).toBe(true);
  });

  it("folds simple multiplication", async () => {
    const ast = await parseExpr("60 * 5");
    const r = foldNumericExpression(ast);
    expect(r.value).toBe(300);
    expect(r.resolved).toBe(true);
  });

  it("folds the canonical Stripe 5-minute-in-ms idiom", async () => {
    const ast = await parseExpr("5 * 60 * 1000");
    expect(foldNumericExpression(ast).value).toBe(300_000);
  });

  it("folds 1-hour-in-ms idioms in both shapes", async () => {
    expect(foldNumericExpression(await parseExpr("60 * 60 * 1000")).value).toBe(3_600_000);
    expect(foldNumericExpression(await parseExpr("3600 * 1000")).value).toBe(3_600_000);
  });

  it("folds division and modulus", async () => {
    expect(foldNumericExpression(await parseExpr("1000 / 2")).value).toBe(500);
    expect(foldNumericExpression(await parseExpr("17 % 5")).value).toBe(2);
  });

  it("folds exponentiation", async () => {
    expect(foldNumericExpression(await parseExpr("2 ** 10")).value).toBe(1024);
  });

  it("folds unary minus and plus", async () => {
    expect(foldNumericExpression(await parseExpr("-300")).value).toBe(-300);
    expect(foldNumericExpression(await parseExpr("+300")).value).toBe(300);
  });

  it("folds nested compound arithmetic", async () => {
    // (5 * 60 + 30) * 1000 = 330_000
    expect(foldNumericExpression(await parseTopExpr("(5 * 60 + 30) * 1000")).value).toBe(330_000);
  });
});

describe("foldNumericExpression — refuses to fold non-literal leaves", () => {
  it("returns null when an identifier appears as a leaf", async () => {
    const r = foldNumericExpression(await parseExpr("TOLERANCE * 1000"));
    expect(r.value).toBeNull();
    expect(r.resolved).toBe(false);
  });

  it("returns null when a function call appears", async () => {
    const r = foldNumericExpression(await parseExpr("parseInt('300') * 1000"));
    expect(r.value).toBeNull();
  });

  it("returns null for unsupported operators (bitwise &)", async () => {
    const r = foldNumericExpression(await parseExpr("0xff & 0x0f"));
    expect(r.value).toBeNull();
  });

  it("returns null for division by zero (not Infinity)", async () => {
    const r = foldNumericExpression(await parseExpr("1 / 0"));
    expect(r.value).toBeNull();
  });

  it("returns null for modulus by zero", async () => {
    const r = foldNumericExpression(await parseExpr("1 % 0"));
    expect(r.value).toBeNull();
  });

  it("returns null for template literals (not a numeric shape)", async () => {
    const r = foldNumericExpression(await parseExpr("`${5}` * 1000"));
    expect(r.value).toBeNull();
  });
});

describe("foldNumericExpression — boundary inputs", () => {
  it("returns null for null/undefined", () => {
    expect(foldNumericExpression(null).value).toBeNull();
    expect(foldNumericExpression(undefined).value).toBeNull();
  });
});
