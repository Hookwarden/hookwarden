// Phase 27 (FIX-GO-01 #2) — Go raw-body-misuse codegen tests (FIX-GO-01b + negative).
// The Go raw-body fix is a multi-statement restructure (read raw bytes before decode + reuse for
// the MAC), never a clean single-range replace → classified manual-only (Assumption A3).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { type Finding, type GoRuntime, initGoRuntime, parseGo } from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { goReplaceBodyWithRaw } from "../../src/fix/go-replace-body-with-raw.js";

const CLI_WASM_DIR = path.resolve(__dirname, "../../../cli/wasm");
let goRuntime: GoRuntime;

beforeAll(async () => {
  const bytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-go.wasm"));
  goRuntime = await initGoRuntime({ wasmBytes: bytes });
}, 30_000);

function mkFinding(line: number): Finding {
  return {
    id: "test:1" as Finding["id"],
    rule_id: "stripe/raw-body-misuse",
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

describe("goReplaceBodyWithRaw — conservative manual-only classification", () => {
  it("flags json.NewDecoder(r.Body).Decode(...) and emits manual-only guidance with io.ReadAll", async () => {
    const src = "package x\nfunc f(r *http.Request) { json.NewDecoder(r.Body).Decode(&evt) }\n";
    const parsed = await parse(src);
    const fix = goReplaceBodyWithRaw(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix?.safety).toBe("manual-only");
    expect(fix?.after).toContain("io.ReadAll");
    expect(fix?.before).toContain("json.NewDecoder");
  });

  it("flags json.Unmarshal(...) used as signing input (manual-only)", async () => {
    const src = "package x\nfunc f() { json.Unmarshal(buf, &evt) }\n";
    const parsed = await parse(src);
    const fix = goReplaceBodyWithRaw(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix?.safety).toBe("manual-only");
  });

  it("flags gin c.ShouldBindJSON(...) (manual-only)", async () => {
    const src = "package x\nfunc f(c *gin.Context) { c.ShouldBindJSON(&evt) }\n";
    const parsed = await parse(src);
    const fix = goReplaceBodyWithRaw(parsed, mkFinding(2));
    expect(fix?.safety).toBe("manual-only");
  });
});

describe("goReplaceBodyWithRaw — negative cases", () => {
  it("returns null when the line already reads raw bytes via io.ReadAll", async () => {
    const src = "package x\nfunc f(r *http.Request) { body, _ := io.ReadAll(r.Body); _ = body }\n";
    const parsed = await parse(src);
    expect(goReplaceBodyWithRaw(parsed, mkFinding(2))).toBeNull();
  });

  it("returns null when no body-decode shape is present on the line", async () => {
    const src = "package x\nfunc f() { x := 1; _ = x }\n";
    const parsed = await parse(src);
    expect(goReplaceBodyWithRaw(parsed, mkFinding(2))).toBeNull();
  });

  it("returns null when dialect is not tree-sitter-go", async () => {
    const parsed = await parse("package x\nvar y = 1\n");
    const fake = { ...parsed, dialect: "babel" as const };
    expect(goReplaceBodyWithRaw(fake, mkFinding(1))).toBeNull();
  });
});
