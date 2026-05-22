import { beforeAll, describe, expect, it } from "vitest";
import { initPhpRuntime, parsePhp, type Finding, type PhpRuntime } from "@hookwarden/engine";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { phpInsertSecretPresenceCheck } from "../../src/fix/php-insert-secret-presence-check.js";

let phpRuntime: PhpRuntime;
beforeAll(async () => {
  const bytes = await fs.readFile(
    path.resolve(__dirname, "../../../cli/wasm/tree-sitter-php.wasm"),
  );
  phpRuntime = await initPhpRuntime({ wasmBytes: bytes });
}, 30_000);

const mkFinding = (line: number): Finding => ({
  id: "t:1" as Finding["id"],
  rule_id: "stripe/missing-secret-presence-check",
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

describe("phpInsertSecretPresenceCheck", () => {
  it("inserts a guard above getenv('WEBHOOK_SECRET')", async () => {
    const src = "<?php\n$sig = getenv(\"WEBHOOK_SECRET\");\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fix = phpInsertSecretPresenceCheck(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.after).toContain(
      'if (!getenv("WEBHOOK_SECRET")) throw new RuntimeException("WEBHOOK_SECRET is not set")',
    );
  });

  it("returns null when a guard exists on the previous line", async () => {
    const src =
      '<?php\nif (!getenv("WEBHOOK_SECRET")) throw new RuntimeException("x");\n$sig = getenv("WEBHOOK_SECRET");\n';
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    expect(phpInsertSecretPresenceCheck(parsed, mkFinding(3))).toBeNull();
  });

  it("returns null on dialect mismatch", async () => {
    const src = "<?php\n$x = 1;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fake = { ...parsed, dialect: "babel" as const };
    expect(phpInsertSecretPresenceCheck(fake, mkFinding(2))).toBeNull();
  });
});
