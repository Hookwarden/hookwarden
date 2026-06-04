// Phase 27 (FIX-GO-01 #1) — Go timing-unsafe-comparison codegen tests (FIX-GO-01a + negatives).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { type Finding, type GoRuntime, initGoRuntime, parseGo } from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { goReplaceBinaryEquality } from "../../src/fix/go-replace-binary-equality.js";

const CLI_WASM_DIR = path.resolve(__dirname, "../../../cli/wasm");
let goRuntime: GoRuntime;

beforeAll(async () => {
  const bytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-go.wasm"));
  goRuntime = await initGoRuntime({ wasmBytes: bytes });
}, 30_000);

function mkFinding(line: number): Finding {
  return {
    id: "test:1" as Finding["id"],
    rule_id: "stripe/timing-unsafe-comparison",
    provider: "stripe",
    severity: "critical",
    state: "not-verified",
    file_path: "f.go",
    location: { line, col: 1 },
    snippet: "",
    handler_id: null,
    primary_location_line_hash: "0",
    message: "test",
    metadata: {},
  };
}
const parse = (src: string) => parseGo({ file_path: "f.go", source_text: src }, goRuntime);

describe("goReplaceBinaryEquality — positive cases", () => {
  it("rewrites bytes.Equal(mac, sig) → hmac.Equal(mac, sig)", async () => {
    const src =
      'package x\nimport ("bytes"\n"crypto/hmac")\nfunc f() bool { return bytes.Equal(mac, sig) }\n';
    const parsed = await parse(src);
    const fix = goReplaceBinaryEquality(parsed, mkFinding(4));
    expect(fix).not.toBeNull();
    expect(fix?.before).toBe("bytes.Equal(mac, sig)");
    expect(fix?.after).toBe("hmac.Equal(mac, sig)");
    expect(fix?.safety).toBe("safe");
    // crypto/hmac already imported → no importsToAdd.
    expect(fix?.importsToAdd).toBeUndefined();
  });

  it("rewrites string(mac) == sig → hmac.Equal([]byte(mac), []byte(sig))", async () => {
    const src = 'package x\nimport "crypto/hmac"\nfunc f() bool { return string(mac) == sig }\n';
    const parsed = await parse(src);
    const fix = goReplaceBinaryEquality(parsed, mkFinding(3));
    expect(fix).not.toBeNull();
    expect(fix?.after).toBe("hmac.Equal([]byte(mac), []byte(sig))");
    expect(fix?.safety).toBe("safe");
  });

  it("emits importsToAdd crypto/hmac when only bytes is imported", async () => {
    const src = 'package x\nimport "bytes"\nfunc f() bool { return bytes.Equal(mac, sig) }\n';
    const parsed = await parse(src);
    const fix = goReplaceBinaryEquality(parsed, mkFinding(3));
    expect(fix).not.toBeNull();
    expect(fix?.importsToAdd).toEqual([{ module: "crypto/hmac" }]);
  });
});

describe("goReplaceBinaryEquality — negative cases", () => {
  it("does NOT fix != (deferred, mirrors PHP/Python)", async () => {
    const src = 'package x\nimport "crypto/hmac"\nfunc f() bool { return string(mac) != sig }\n';
    const parsed = await parse(src);
    expect(goReplaceBinaryEquality(parsed, mkFinding(3))).toBeNull();
  });

  it("returns null when the line already uses hmac.Equal", async () => {
    const src = 'package x\nimport "crypto/hmac"\nfunc f() bool { return hmac.Equal(mac, sig) }\n';
    const parsed = await parse(src);
    expect(goReplaceBinaryEquality(parsed, mkFinding(3))).toBeNull();
  });

  it("returns null when dialect is not tree-sitter-go", async () => {
    const parsed = await parse("package x\nvar y = 1\n");
    const fake = { ...parsed, dialect: "babel" as const };
    expect(goReplaceBinaryEquality(fake, mkFinding(1))).toBeNull();
  });

  it("returns null on parse error", async () => {
    const parsed = await parse("package x\nfunc f( {\n");
    expect(goReplaceBinaryEquality(parsed, mkFinding(2))).toBeNull();
  });
});
