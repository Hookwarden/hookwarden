// Phase 27 (RULES-GO-01) — tests for shared Go AST helpers, incl. the bytes.Equal-is-the-bug
// discipline (Pitfall 2) and adversary-shaped comparisons (MEMORY feedback_negative_tests_required).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type GoRuntime, initGoRuntime, parseGo } from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import {
  findInsecureMacComparisons,
  type GoTree,
  goTimingUnsafeResult,
  isGoBytesEqualCall,
  isGoHmacEqualCall,
} from "../../src/predicates/_helpers-go.js";

const require = createRequire(import.meta.url);
function resolveGoWasmPath(): string {
  const pkgPath = require.resolve("tree-sitter-go/package.json");
  return join(dirname(pkgPath), "tree-sitter-go.wasm");
}

let runtime: GoRuntime;
beforeAll(async () => {
  runtime = await initGoRuntime({ wasmBytes: new Uint8Array(readFileSync(resolveGoWasmPath())) });
}, 30_000);

async function root(src: string): Promise<GoTree["rootNode"]> {
  const pf = await parseGo({ file_path: "x.go", source_text: src }, runtime);
  return (pf.raw_ast as GoTree).rootNode;
}

describe("Go MAC-compare classification", () => {
  it("classifies hmac.Equal safe and bytes.Equal as the bug (Pitfall 2)", () => {
    expect(isGoHmacEqualCall("hmac.Equal")).toBe(true);
    expect(isGoHmacEqualCall("bytes.Equal")).toBe(false);
    expect(isGoBytesEqualCall("bytes.Equal")).toBe(true);
    expect(isGoBytesEqualCall("hmac.Equal")).toBe(false);
  });
});

describe("findInsecureMacComparisons", () => {
  it("flags bytes.Equal(mac, sig) on signature-shaped operands", async () => {
    const r = await root(
      "package x\nfunc f() {\n\tif bytes.Equal(expectedMAC, gotSig) {\n\t}\n}\n",
    );
    expect(findInsecureMacComparisons(r).length).toBeGreaterThan(0);
  });

  it("flags string(mac) == sig (binary == on signature material)", async () => {
    const r = await root(
      "package x\nfunc f() {\n\tif string(mac) == sig {\n\t}\n}\n",
    );
    const found = findInsecureMacComparisons(r);
    expect(found.some((c) => c.operator === "==")).toBe(true);
  });

  it("flags expected == sig", async () => {
    const r = await root("package x\nfunc f() {\n\tif expected == sig {\n\t}\n}\n");
    expect(findInsecureMacComparisons(r).length).toBeGreaterThan(0);
  });

  it("returns empty for a handler that uses ONLY hmac.Equal (no FP on the safe form)", async () => {
    const r = await root(
      "package x\nfunc f() {\n\tif hmac.Equal(macA, macB) {\n\t}\n}\n",
    );
    expect(findInsecureMacComparisons(r)).toEqual([]);
  });

  it("does not flag a non-signature equality (if status == 200)", async () => {
    const r = await root("package x\nfunc f() {\n\tif status == 200 {\n\t}\n}\n");
    expect(findInsecureMacComparisons(r)).toEqual([]);
  });
});

describe("goTimingUnsafeResult", () => {
  it("returns not-verified for hmac.New + bytes.Equal(mac, sig)", async () => {
    const r = await root(
      "package x\nfunc f() {\n\tmac := hmac.New(sha256.New, key)\n\tmac.Write(body)\n\tif bytes.Equal(mac.Sum(nil), sig) {\n\t}\n}\n",
    );
    expect(goTimingUnsafeResult(r)).toBe("not-verified");
  });

  it("returns null when hmac.Equal is used (safe form)", async () => {
    const r = await root(
      "package x\nfunc f() {\n\tmac := hmac.New(sha256.New, key)\n\tmac.Write(body)\n\tif hmac.Equal(mac.Sum(nil), sig) {\n\t}\n}\n",
    );
    expect(goTimingUnsafeResult(r)).toBeNull();
  });

  it("returns null when there is no manual HMAC (rule does not apply)", async () => {
    const r = await root("package x\nfunc f() {\n\tif expected == sig {\n\t}\n}\n");
    expect(goTimingUnsafeResult(r)).toBeNull();
  });
});
