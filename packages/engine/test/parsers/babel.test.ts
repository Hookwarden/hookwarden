import { describe, expect, it } from "vitest";
import { parseJsTs } from "../../src/parsers/babel.js";

describe("parseJsTs — happy path", () => {
  it("parses a TS file and returns dialect: 'babel', language: 'typescript'", async () => {
    const result = await parseJsTs({
      file_path: "src/webhook.ts",
      source_text: "import { Stripe } from 'stripe'; export const x: number = 1;",
    });
    expect(result.dialect).toBe("babel");
    expect(result.language).toBe("typescript");
    expect(result.parse_error).toBeNull();
    expect(result.raw_ast).not.toBeNull();
  });

  it("parses a TSX file with JSX + decorators", async () => {
    const result = await parseJsTs({
      file_path: "src/component.tsx",
      source_text: `
        const x = 1;
        @sealed
        class C {
          render() { return <div>{x}</div>; }
        }
      `,
    });
    expect(result.parse_error).toBeNull();
    expect(result.language).toBe("typescript");
  });

  it("parses top-level await", async () => {
    const result = await parseJsTs({
      file_path: "src/init.ts",
      source_text: "const data = await fetch('/api');",
    });
    expect(result.parse_error).toBeNull();
  });

  it("respects file extension when hint is omitted", async () => {
    const js = await parseJsTs({
      file_path: "src/legacy.js",
      source_text: "module.exports = function () { return 1; };",
    });
    expect(js.language).toBe("javascript");
    expect(js.parse_error).toBeNull();
  });
});

describe("parseJsTs — import enumeration (ImportEdge)", () => {
  it("captures named, default, and namespace imports", async () => {
    const result = await parseJsTs({
      file_path: "src/a.ts",
      source_text: `
        import { constructEvent as verify } from 'stripe';
        import express from 'express';
        import * as crypto from 'node:crypto';
      `,
    });
    expect(result.imports).toHaveLength(3);
    const stripe = result.imports.find((i) => i.to_module === "stripe");
    expect(stripe?.imported_names).toEqual([{ local: "verify", source: "constructEvent" }]);
    const exp = result.imports.find((i) => i.to_module === "express");
    expect(exp?.is_default).toBe(true);
    const ns = result.imports.find((i) => i.to_module === "node:crypto");
    expect(ns?.imported_names[0]?.source).toBe("*");
  });

  it("captures top-level CommonJS require()", async () => {
    const result = await parseJsTs({
      file_path: "src/cjs.js",
      source_text: "const stripe = require('stripe'); const x = require('./util');",
    });
    expect(result.imports).toHaveLength(2);
    expect(result.imports[0]?.to_module).toBe("stripe");
    expect(result.imports[1]?.to_module).toBe("./util");
  });
});

describe("parseJsTs — D-27 all-or-nothing parse error (ENGINE-07)", () => {
  it("returns ParseErrorRecord and empty imports on syntax error", async () => {
    const result = await parseJsTs({
      file_path: "src/broken.ts",
      source_text: "const x = ;\nconst y = 1;",
    });
    expect(result.parse_error).not.toBeNull();
    expect(result.parse_error?.source).toBe("babel");
    expect(result.parse_error?.location.line).toBeGreaterThan(0);
    expect(result.imports).toEqual([]);
    expect(result.raw_ast).toBeNull();
  });

  it("returns ParseErrorRecord on completely empty Babel-incompatible content", async () => {
    const result = await parseJsTs({
      file_path: "src/garbage.ts",
      source_text: "@@@!!!---",
    });
    expect(result.parse_error).not.toBeNull();
  });
});
