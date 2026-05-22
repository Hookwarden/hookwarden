import { promises as fs } from "node:fs";
import * as path from "node:path";
import { type Finding, initPhpRuntime, type PhpRuntime, parsePhp } from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { phpReplaceInputWithRawBody } from "../../src/fix/php-replace-input-with-raw-body.js";

let phpRuntime: PhpRuntime;
beforeAll(async () => {
  const bytes = await fs.readFile(
    path.resolve(__dirname, "../../../cli/wasm/tree-sitter-php.wasm"),
  );
  phpRuntime = await initPhpRuntime({ wasmBytes: bytes });
}, 30_000);

const mkFinding = (line: number): Finding => ({
  id: "t:1" as Finding["id"],
  rule_id: "stripe/raw-body-misuse",
  provider: "stripe",
  severity: "high",
  state: "not-verified",
  file_path: "x.php",
  location: { line, col: 1 },
  snippet: "",
  handler_id: null,
  primary_location_line_hash: "0",
  message: "",
  metadata: {},
});

describe("phpReplaceInputWithRawBody", () => {
  it("rewrites $_POST superglobal usage", async () => {
    const src = "<?php\n$body = $_POST['payload'];\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fix = phpReplaceInputWithRawBody(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.after).toBe('file_get_contents("php://input")');
  });

  it("returns null when already using php://input", async () => {
    const src = '<?php\n$body = file_get_contents("php://input");\n';
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    expect(phpReplaceInputWithRawBody(parsed, mkFinding(2))).toBeNull();
  });

  it("returns null on dialect mismatch", async () => {
    const src = "<?php\n$x = 1;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fake = { ...parsed, dialect: "babel" as const };
    expect(phpReplaceInputWithRawBody(fake, mkFinding(2))).toBeNull();
  });
});
