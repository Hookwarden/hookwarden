// Phase 8.1 Plan 08 — tests for shared PHP AST helpers.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { initPhpRuntime, parsePhp, type PhpRuntime } from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import {
  findInsecureStringComparisons,
  isPhpHashEqualsCall,
  isPhpManualHmacEntry,
  isPhpStrcmpCall,
  walkPhpCalls,
  type PhpTree,
} from "../../src/predicates/_helpers-php.js";

const require = createRequire(import.meta.url);
function resolvePhpWasmPath(): string {
  const pkgPath = require.resolve("tree-sitter-php/package.json");
  return join(dirname(pkgPath), "tree-sitter-php.wasm");
}

let runtime: PhpRuntime;
beforeAll(async () => {
  runtime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
}, 30_000);

async function parse(src: string): Promise<PhpTree> {
  const file = await parsePhp({ file_path: "x.php", source_text: src }, runtime);
  return file.raw_ast as PhpTree;
}

describe("_helpers-php — string helpers", () => {
  it("isPhpManualHmacEntry matches hash_hmac (incl. leading-backslash form)", () => {
    expect(isPhpManualHmacEntry("hash_hmac")).toBe(true);
    expect(isPhpManualHmacEntry("\\hash_hmac")).toBe(true);
    expect(isPhpManualHmacEntry("Stripe::method")).toBe(false);
  });

  it("isPhpHashEqualsCall matches hash_equals only", () => {
    expect(isPhpHashEqualsCall("hash_equals")).toBe(true);
    expect(isPhpHashEqualsCall("\\hash_equals")).toBe(true);
    expect(isPhpHashEqualsCall("hash_hmac")).toBe(false);
  });

  it("isPhpStrcmpCall matches both strcmp and strcasecmp", () => {
    expect(isPhpStrcmpCall("strcmp")).toBe(true);
    expect(isPhpStrcmpCall("strcasecmp")).toBe(true);
    expect(isPhpStrcmpCall("\\strcmp")).toBe(true);
    expect(isPhpStrcmpCall("strpos")).toBe(false);
  });
});

describe("_helpers-php — findInsecureStringComparisons", () => {
  it("flags $expected === $sig as triple-equals timing-unsafe", async () => {
    const tree = await parse(
      "<?php\n$expected = hash_hmac('sha256', $body, $secret);\n" +
        "if ($expected === $sig) { echo 'ok'; }\n",
    );
    const results = findInsecureStringComparisons(tree.rootNode);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.operator === "===")).toBe(true);
  });

  it("flags $expected == $sig (double-equals) too", async () => {
    const tree = await parse(
      "<?php\n$expected = hash_hmac('sha256', $body, $secret);\n" +
        "if ($expected == $sig) { echo 'ok'; }\n",
    );
    const results = findInsecureStringComparisons(tree.rootNode);
    expect(results.some((r) => r.operator === "==")).toBe(true);
  });

  it("flags strcmp($expected, $sig) === 0 (the PHP-specific D-09 case)", async () => {
    const tree = await parse(
      "<?php\n$expected = hash_hmac('sha256', $body, $secret);\n" +
        "if (strcmp($expected, $sig) === 0) { echo 'ok'; }\n",
    );
    const results = findInsecureStringComparisons(tree.rootNode);
    expect(results.some((r) => r.operator === "strcmp")).toBe(true);
  });

  it("does NOT flag hash_equals($expected, $sig)", async () => {
    const tree = await parse(
      "<?php\nif (hash_equals($expected, $sig)) { echo 'ok'; }\n",
    );
    const results = findInsecureStringComparisons(tree.rootNode);
    // hash_equals call lives inside an if condition; the condition node is not a
    // binary_expression so findInsecureStringComparisons emits nothing.
    expect(results).toEqual([]);
  });

  it("does NOT flag arbitrary $x === 'yes' where neither side resembles signature material", async () => {
    const tree = await parse(
      "<?php\n$status = 'yes';\nif ($status === 'yes') { echo 'ok'; }\n",
    );
    expect(findInsecureStringComparisons(tree.rootNode)).toEqual([]);
  });
});

describe("_helpers-php — walkPhpCalls", () => {
  it("enumerates function / member / scoped call sites", async () => {
    const tree = await parse(
      "<?php\n" +
        "$x = hash_hmac('sha256', $b, $s);\n" + // function
        "$y = $obj->method($x);\n" + // member
        "$z = Klass::staticCall($y);\n", // scoped
    );
    const calls = walkPhpCalls(tree.rootNode);
    const kinds = new Set(calls.map((c) => c.kind));
    expect(kinds.has("function")).toBe(true);
    expect(kinds.has("member")).toBe(true);
    expect(kinds.has("scoped")).toBe(true);
    expect(calls.some((c) => c.text.includes("hash_hmac"))).toBe(true);
  });
});
