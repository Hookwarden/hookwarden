// Phase 8.2 Plan 06 Task 1: JS/TS timing-unsafe-comparison codegen tests.

import { type Finding, parseJsTs } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { typescriptReplaceBinaryEquality } from "../../src/fix/typescript-replace-binary-equality.js";

function mkFinding(line: number, ruleId = "stripe/timing-unsafe-comparison"): Finding {
  return {
    id: "test:1" as Finding["id"],
    rule_id: ruleId,
    provider: "stripe",
    severity: "critical",
    state: "not-verified",
    file_path: "x.ts",
    location: { line, col: 1 },
    snippet: "",
    handler_id: null,
    primary_location_line_hash: "0",
    message: "test",
    metadata: {},
  };
}

describe("typescriptReplaceBinaryEquality — positive cases", () => {
  it("rewrites `expected === sig` → crypto.timingSafeEqual(Buffer.from(...), Buffer.from(...))", async () => {
    const src = "import crypto from 'node:crypto';\nif (expected === sig) {}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptReplaceBinaryEquality(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.before).toBe("expected === sig");
    expect(fix!.after).toBe("crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))");
    expect(fix!.safety).toBe("safe");
    expect(fix!.importsToAdd).toBeUndefined();
  });

  it("rewrites `==` (loose equality) the same way", async () => {
    const src = "import crypto from 'node:crypto';\nif (expected == sig) {}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptReplaceBinaryEquality(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.before).toBe("expected == sig");
  });

  it("emits importsToAdd when crypto is NOT imported", async () => {
    const src = "if (expected === sig) {}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptReplaceBinaryEquality(parsed, mkFinding(1));
    expect(fix).not.toBeNull();
    expect(fix!.importsToAdd).toEqual([{ specifier: "node:crypto", default_name: "crypto" }]);
  });

  it("preserves verbatim left/right source slices (computed buffers)", async () => {
    const src = "if (Buffer.from(a) === Buffer.from(b)) {}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptReplaceBinaryEquality(parsed, mkFinding(1));
    expect(fix).not.toBeNull();
    expect(fix!.after).toBe(
      "crypto.timingSafeEqual(Buffer.from(Buffer.from(a)), Buffer.from(Buffer.from(b)))",
    );
  });
});

describe("typescriptReplaceBinaryEquality — handler-anchored findings (multi-line handlers)", () => {
  // Regression: findings anchor to the handler declaration line, but the insecure comparison
  // lives several lines into the handler body. The codegen must search the handler's span,
  // not just the finding's line — otherwise `fix` never works on real multi-line handlers.
  it("rewrites a comparison several lines below the handler-anchored finding line", async () => {
    const src =
      "import crypto from 'node:crypto';\n" + // 1
      "app.post('/webhooks/github', (req, res) => {\n" + // 2 — finding anchors here
      "  const expected = compute();\n" + // 3
      "  const sig = req.header('X-Hub-Signature-256');\n" + // 4
      "  if (expected === sig) return res.end();\n" + // 5 — the comparison
      "});\n"; // 6
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptReplaceBinaryEquality(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.before).toBe("expected === sig");
    expect(fix!.after).toBe("crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))");
  });

  it("declines (null) when the handler span holds two ==/=== comparisons — ambiguous", async () => {
    const src =
      "import crypto from 'node:crypto';\n" + // 1
      "app.post('/webhooks/github', (req, res) => {\n" + // 2 — finding anchors here
      "  if (req.method === 'POST') {}\n" + // 3 — unrelated equality
      "  if (expected === sig) return res.end();\n" + // 4 — the real one
      "});\n"; // 5
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptReplaceBinaryEquality(parsed, mkFinding(2))).toBeNull();
  });
});

describe("typescriptReplaceBinaryEquality — negative cases", () => {
  it("returns null when dialect is not babel", async () => {
    const src = "if (a === b) {}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fake = { ...parsed, dialect: "tree-sitter-python" as const };
    expect(typescriptReplaceBinaryEquality(fake, mkFinding(1))).toBeNull();
  });

  it("returns null when parse_error is non-null", async () => {
    const src = "if (";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(parsed.parse_error).not.toBeNull();
    expect(typescriptReplaceBinaryEquality(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when no BinaryExpression at finding.line", async () => {
    const src = "const x = 1;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptReplaceBinaryEquality(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when comparison uses non-equality operator (e.g., <)", async () => {
    const src = "if (a < b) {}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptReplaceBinaryEquality(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when source already uses crypto.timingSafeEqual on that line", async () => {
    const src = "crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptReplaceBinaryEquality(parsed, mkFinding(1))).toBeNull();
  });
});
