// Phase 8.2 Plan 06 Task 2: Python timing-unsafe-comparison codegen tests.

import { beforeAll, describe, expect, it } from "vitest";
import {
  initPythonRuntime,
  parsePython,
  type Finding,
  type PythonRuntime,
} from "@hookwarden/engine";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pythonReplaceBinaryEquality } from "../../src/fix/python-replace-binary-equality.js";

const CLI_WASM_DIR = path.resolve(__dirname, "../../../cli/wasm");
let pythonRuntime: PythonRuntime;

beforeAll(async () => {
  const bytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-python.wasm"));
  pythonRuntime = await initPythonRuntime({ wasmBytes: bytes });
}, 30_000);

function mkFinding(line: number): Finding {
  return {
    id: "test:1" as Finding["id"],
    rule_id: "stripe/timing-unsafe-comparison",
    provider: "stripe",
    severity: "critical",
    state: "not-verified",
    file_path: "f.py",
    location: { line, col: 1 },
    snippet: "",
    handler_id: null,
    primary_location_line_hash: "0",
    message: "test",
    metadata: {},
  };
}

describe("pythonReplaceBinaryEquality — positive cases", () => {
  it("rewrites `expected == sig` → hmac.compare_digest(expected, sig)", async () => {
    const src = "import hmac\nif expected == sig:\n    pass\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const fix = pythonReplaceBinaryEquality(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.before).toBe("expected == sig");
    expect(fix!.after).toBe("hmac.compare_digest(expected, sig)");
    expect(fix!.safety).toBe("safe");
    expect(fix!.importsToAdd).toBeUndefined();
  });

  it("emits importsToAdd when hmac is NOT imported", async () => {
    const src = "if expected == sig:\n    pass\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const fix = pythonReplaceBinaryEquality(parsed, mkFinding(1));
    expect(fix).not.toBeNull();
    expect(fix!.importsToAdd).toEqual([{ module: "hmac" }]);
  });
});

describe("pythonReplaceBinaryEquality — negative cases", () => {
  it("returns null for `!=` (v0.5 only supports ==)", async () => {
    const src = "if expected != sig:\n    pass\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    expect(pythonReplaceBinaryEquality(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when dialect is not tree-sitter-python", async () => {
    const src = "x = 1\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const fake = { ...parsed, dialect: "babel" as const };
    expect(pythonReplaceBinaryEquality(fake, mkFinding(1))).toBeNull();
  });

  it("returns null when parse_error is non-null", async () => {
    const src = "def )(:\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    expect(parsed.parse_error).not.toBeNull();
    expect(pythonReplaceBinaryEquality(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when source already uses hmac.compare_digest on that line", async () => {
    const src = "hmac.compare_digest(a, b)\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    expect(pythonReplaceBinaryEquality(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when no comparison at finding.line", async () => {
    const src = "x = 1\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    expect(pythonReplaceBinaryEquality(parsed, mkFinding(1))).toBeNull();
  });
});
