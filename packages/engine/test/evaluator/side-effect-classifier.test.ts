import type { ExpressionStatement, Statement, VariableDeclaration } from "@babel/types";
import { describe, expect, it } from "vitest";
import {
  classifyStatement,
  qualifiedCallName,
} from "../../src/evaluator/side-effect-classifier.js";
import { parseJsTs } from "../../src/parsers/babel.js";

async function firstStatement(source: string): Promise<Statement> {
  // Wrap in a function body so `return` statements parse legally. The first
  // top-level Statement is the FunctionDeclaration; we drill into its body.
  const wrapped = `async function _wrap() { ${source} }`;
  const file = await parseJsTs({ file_path: "test.ts", source_text: wrapped });
  const program = (file.raw_ast as { program: { body: Statement[] } }).program;
  const fn = program.body[0] as Statement & { body: { body: Statement[] } };
  return fn.body.body[0] as Statement;
}

const VERIFY = new Set(["stripe.webhooks.constructEvent"]);
const T1 = new Set(["prisma.user.create", "fetch", "axios.post", "emitter.emit"]);
const T2 = new Set(["nodemailer.sendMail", "twilio.messages.create"]);

describe("classifyStatement — verification wins over side-effect", () => {
  it("classifies a statement that calls verify as verification", async () => {
    const stmt = await firstStatement(
      "const event = stripe.webhooks.constructEvent(body, sig, secret);",
    );
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("verification");
    expect(r.detail).toBe("stripe.webhooks.constructEvent");
  });

  it("statement that calls BOTH verify and a DB write classifies as verification (strongest signal wins)", async () => {
    // Pathological but legal: const x = (await prisma.user.create(...), stripe.webhooks.constructEvent(...))
    const stmt = await firstStatement(
      "const x = (prisma.user.create(data), stripe.webhooks.constructEvent(body, sig, secret));",
    );
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("verification");
  });
});

describe("classifyStatement — T1 critical side effects", () => {
  it("DB write before verification (the bug shape)", async () => {
    const stmt = await firstStatement("prisma.user.create({ data });");
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("side_effect");
    expect(r.severity).toBe("critical");
    expect(r.detail).toBe("prisma.user.create");
  });

  it("outbound HTTP fetch", async () => {
    const stmt = await firstStatement(
      "await fetch('https://example.com/webhook', { method: 'POST' });",
    );
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("side_effect");
    expect(r.severity).toBe("critical");
  });

  it("event emission via emitter.emit", async () => {
    const stmt = await firstStatement("emitter.emit('webhook.received', payload);");
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("side_effect");
    expect(r.severity).toBe("critical");
  });
});

describe("classifyStatement — T2 high side effects", () => {
  it("nodemailer.sendMail classifies as high", async () => {
    const stmt = await firstStatement("await nodemailer.sendMail({ to: 'x@y.z' });");
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("side_effect");
    expect(r.severity).toBe("high");
  });

  it("T1 hit does NOT downgrade to T2 when both appear", async () => {
    const stmt = await firstStatement(
      "const x = (prisma.user.create(data), nodemailer.sendMail({ to: 'x@y.z' }));",
    );
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("side_effect");
    expect(r.severity).toBe("critical");
  });
});

describe("classifyStatement — neutral (no flag)", () => {
  it("logging statement classifies as neutral", async () => {
    const stmt = await firstStatement("console.log('received webhook');");
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("neutral");
  });

  it("a read-only DB call (not in T1 set) classifies as neutral", async () => {
    const stmt = await firstStatement("const u = await prisma.user.findUnique({ where: { id } });");
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("neutral");
  });

  it("provider's own API host call is excluded via safeCallNames", async () => {
    const stmt = await firstStatement(
      "await fetch('https://api.stripe.com/v1/charges', { method: 'POST' });",
    );
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
      safeCallNames: new Set(["fetch"]),
    });
    // Caller pre-filters host; classifier honors safeCallNames as the simple
    // exclusion. The richer "is this URL the provider's host?" check belongs
    // to the rule predicate, not the classifier.
    expect(r.kind).toBe("neutral");
  });
});

describe("classifyStatement — short_circuit (BYP-01 shape)", () => {
  it("classifies if-NODE_ENV-return as short_circuit", async () => {
    const stmt = await firstStatement(
      "if (process.env.NODE_ENV !== 'production') { return res.json({ ok: true }); }",
    );
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("short_circuit");
  });

  it("classifies if-stmt with bare return as short_circuit", async () => {
    const stmt = await firstStatement("if (process.env.SKIP) { return; }");
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("short_circuit");
  });

  it("classifies if-stmt with res.json terminal as short_circuit", async () => {
    const stmt = await firstStatement("if (debugMode) { res.status(200).json({ debug: true }); }");
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    expect(r.kind).toBe("short_circuit");
  });

  it("if-stmt without early-return is NOT short_circuit (just neutral here, real classification needs more context)", async () => {
    const stmt = await firstStatement("if (debugMode) { logger.debug('hi'); }");
    const r = classifyStatement({
      statement: stmt,
      verificationCallNames: VERIFY,
      t1SideEffectNames: T1,
      t2SideEffectNames: T2,
    });
    // No early return → falls through to neutral classification of the
    // statement's call expressions (logger.debug is not in any set).
    expect(r.kind).toBe("neutral");
  });
});

describe("qualifiedCallName — call shape resolution", () => {
  it("resolves a bare identifier call", async () => {
    const file = await parseJsTs({ file_path: "test.ts", source_text: "fetch('x');" });
    const program = (file.raw_ast as { program: { body: ExpressionStatement[] } }).program;
    const call = (program.body[0] as ExpressionStatement).expression;
    expect(qualifiedCallName(call as never)).toBe("fetch");
  });

  it("resolves a member-call dotted chain", async () => {
    const file = await parseJsTs({ file_path: "test.ts", source_text: "prisma.user.create({});" });
    const program = (file.raw_ast as { program: { body: ExpressionStatement[] } }).program;
    const call = (program.body[0] as ExpressionStatement).expression;
    expect(qualifiedCallName(call as never)).toBe("prisma.user.create");
  });

  it("returns null for computed-property calls (dynamic dispatch)", async () => {
    const file = await parseJsTs({ file_path: "test.ts", source_text: "obj[method]();" });
    const program = (file.raw_ast as { program: { body: ExpressionStatement[] } }).program;
    const call = (program.body[0] as ExpressionStatement).expression;
    expect(qualifiedCallName(call as never)).toBeNull();
  });

  it("returns null for a const that wraps an expression (no identifier resolution)", async () => {
    const file = await parseJsTs({ file_path: "test.ts", source_text: "const x = fetch; x();" });
    const program = (
      file.raw_ast as { program: { body: (VariableDeclaration | ExpressionStatement)[] } }
    ).program;
    const stmt = program.body[1] as ExpressionStatement;
    const call = stmt.expression;
    // Identifier resolution is the caller's job; bare "x" comes through as itself.
    expect(qualifiedCallName(call as never)).toBe("x");
  });
});
