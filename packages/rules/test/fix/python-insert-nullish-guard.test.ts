import { beforeAll, describe, expect, it } from "vitest";
import { initPythonRuntime, parsePython, type Finding, type PythonRuntime } from "@hookwarden/engine";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pythonInsertNullishGuard } from "../../src/fix/python-insert-nullish-guard.js";

let pythonRuntime: PythonRuntime;
beforeAll(async () => {
  const bytes = await fs.readFile(
    path.resolve(__dirname, "../../../cli/wasm/tree-sitter-python.wasm"),
  );
  pythonRuntime = await initPythonRuntime({ wasmBytes: bytes });
}, 30_000);

const mkFinding = (line: number): Finding => ({
  id: "t:1" as Finding["id"],
  rule_id: "stripe/missing-nullish-guard",
  provider: "stripe",
  severity: "high",
  state: "not-verified",
  file_path: "f.py",
  location: { line, col: 1 },
  snippet: "",
  handler_id: null,
  primary_location_line_hash: "0",
  message: "",
  metadata: {},
});

describe("pythonInsertNullishGuard", () => {
  it("inserts an if-None guard at the HMAC compare line", async () => {
    const src = "def handler(req):\n    hmac.compare_digest(expected, sig)\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const fix = pythonInsertNullishGuard(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.after).toContain("if sig is None");
    expect(fix!.after).toContain('raise ValueError("Webhook signature missing")');
  });

  it("returns null when an `is None` check already exists on the line", async () => {
    const src = "def handler(req):\n    if sig is None: raise ValueError('x')\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    expect(pythonInsertNullishGuard(parsed, mkFinding(2))).toBeNull();
  });

  it("returns null on dialect mismatch", async () => {
    const src = "x = 1\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const fake = { ...parsed, dialect: "babel" as const };
    expect(pythonInsertNullishGuard(fake, mkFinding(1))).toBeNull();
  });
});
