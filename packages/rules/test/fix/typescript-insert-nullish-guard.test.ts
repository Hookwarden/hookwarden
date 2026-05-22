import { describe, expect, it } from "vitest";
import { parseJsTs, type Finding } from "@hookwarden/engine";
import { typescriptInsertNullishGuard } from "../../src/fix/typescript-insert-nullish-guard.js";

const mkFinding = (line: number): Finding => ({
  id: "t:1" as Finding["id"],
  rule_id: "stripe/missing-nullish-guard",
  provider: "stripe",
  severity: "high",
  state: "not-verified",
  file_path: "x.ts",
  location: { line, col: 1 },
  snippet: "",
  handler_id: null,
  primary_location_line_hash: "0",
  message: "",
  metadata: {},
});

describe("typescriptInsertNullishGuard", () => {
  it("inserts an if-throw guard at the line above the HMAC compare", async () => {
    const src = "function handler(req) {\n    crypto.timingSafeEqual(expected, sig);\n}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptInsertNullishGuard(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.before).toBe("");
    expect(fix!.after).toContain('if (!sig) throw new Error("Webhook signature missing")');
    expect(fix!.startByte).toBe(fix!.endByte);
  });

  it("returns null when a guard is already on the line", async () => {
    const src = "function handler(req) {\n    if (!sig) throw new Error('x');\n}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptInsertNullishGuard(parsed, mkFinding(2))).toBeNull();
  });

  it("returns null on dialect mismatch", async () => {
    const src = "x = 1\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fake = { ...parsed, dialect: "tree-sitter-python" as const };
    expect(typescriptInsertNullishGuard(fake, mkFinding(1))).toBeNull();
  });
});
