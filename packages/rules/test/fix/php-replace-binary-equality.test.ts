// Phase 8.2 Plan 06 Task 3: PHP timing-unsafe-comparison codegen tests.

import { beforeAll, describe, expect, it } from "vitest";
import {
  initPhpRuntime,
  parsePhp,
  type Finding,
  type PhpRuntime,
} from "@hookwarden/engine";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { phpReplaceBinaryEqualityOrStrcmp } from "../../src/fix/php-replace-binary-equality-or-strcmp.js";

const CLI_WASM_DIR = path.resolve(__dirname, "../../../cli/wasm");
let phpRuntime: PhpRuntime;

beforeAll(async () => {
  const bytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-php.wasm"));
  phpRuntime = await initPhpRuntime({ wasmBytes: bytes });
}, 30_000);

function mkFinding(line: number): Finding {
  return {
    id: "test:1" as Finding["id"],
    rule_id: "stripe/timing-unsafe-comparison",
    provider: "stripe",
    severity: "critical",
    state: "not-verified",
    file_path: "x.php",
    location: { line, col: 1 },
    snippet: "",
    handler_id: null,
    primary_location_line_hash: "0",
    message: "test",
    metadata: {},
  };
}

describe("phpReplaceBinaryEqualityOrStrcmp — positive cases", () => {
  it("rewrites $expected === $sig → hash_equals($expected, $sig)", async () => {
    const src = "<?php\nif ($expected === $sig) { return true; }\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fix = phpReplaceBinaryEqualityOrStrcmp(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.before).toBe("$expected === $sig");
    expect(fix!.after).toBe("hash_equals($expected, $sig)");
    expect(fix!.safety).toBe("safe");
  });

  it("rewrites strcmp($a, $b) === 0 → hash_equals($a, $b)", async () => {
    const src = "<?php\nif (strcmp($a, $b) === 0) { return true; }\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fix = phpReplaceBinaryEqualityOrStrcmp(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.before).toBe("strcmp($a, $b) === 0");
    expect(fix!.after).toBe("hash_equals($a, $b)");
  });

  it("rewrites strcmp($a, $b) == 0 (loose equality)", async () => {
    const src = "<?php\nif (strcmp($a, $b) == 0) { return true; }\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fix = phpReplaceBinaryEqualityOrStrcmp(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.after).toBe("hash_equals($a, $b)");
  });

  it("emits NO importsToAdd (hash_equals is core PHP)", async () => {
    const src = "<?php\nif ($a === $b) { return true; }\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fix = phpReplaceBinaryEqualityOrStrcmp(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.importsToAdd).toBeUndefined();
  });
});

describe("phpReplaceBinaryEqualityOrStrcmp — negative cases", () => {
  it("returns null when dialect is not tree-sitter-php", async () => {
    const src = "<?php\n$x = 1;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fake = { ...parsed, dialect: "babel" as const };
    expect(phpReplaceBinaryEqualityOrStrcmp(fake, mkFinding(2))).toBeNull();
  });

  it("returns null for `!=`/`!==` (v0.5 fixable set is == / ===)", async () => {
    const src = "<?php\nif ($a !== $b) { return true; }\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    expect(phpReplaceBinaryEqualityOrStrcmp(parsed, mkFinding(2))).toBeNull();
  });

  it("returns null when source already uses hash_equals on that line", async () => {
    const src = "<?php\nhash_equals($a, $b);\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    expect(phpReplaceBinaryEqualityOrStrcmp(parsed, mkFinding(2))).toBeNull();
  });

  it("returns null for non-equality operator", async () => {
    const src = "<?php\nif ($a < $b) { return true; }\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    expect(phpReplaceBinaryEqualityOrStrcmp(parsed, mkFinding(2))).toBeNull();
  });
});
