import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  type Finding,
  initPythonRuntime,
  type PythonRuntime,
  parsePython,
} from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { pythonInsertSecretPresenceCheck } from "../../src/fix/python-insert-secret-presence-check.js";

let pythonRuntime: PythonRuntime;
beforeAll(async () => {
  const bytes = await fs.readFile(
    path.resolve(__dirname, "../../../cli/wasm/tree-sitter-python.wasm"),
  );
  pythonRuntime = await initPythonRuntime({ wasmBytes: bytes });
}, 30_000);

const mkFinding = (line: number): Finding => ({
  id: "t:1" as Finding["id"],
  rule_id: "stripe/missing-secret-presence-check",
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

describe("pythonInsertSecretPresenceCheck", () => {
  it("inserts a guard above os.environ.get('WEBHOOK_SECRET')", async () => {
    const src = 'def h():\n    sig = os.environ.get("WEBHOOK_SECRET")\n';
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const fix = pythonInsertSecretPresenceCheck(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.after).toContain('if not os.environ.get("WEBHOOK_SECRET"):');
    expect(fix!.after).toContain('raise RuntimeError("WEBHOOK_SECRET is not set")');
  });

  it("returns null when no env access on the line", async () => {
    const src = "x = 1\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    expect(pythonInsertSecretPresenceCheck(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when a guard already exists on the immediately-prior line", async () => {
    // Convention: codegen scans the immediately-prior line; if your guard is
    // further away, the codegen will still insert a duplicate guard. The
    // sequential conflict resolver + re-parse loop (Plan 08) catches this.
    const src =
      'if not os.environ.get("WEBHOOK_SECRET"): raise RuntimeError("x")\nsig = os.environ.get("WEBHOOK_SECRET")\n';
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    expect(pythonInsertSecretPresenceCheck(parsed, mkFinding(2))).toBeNull();
  });
});
