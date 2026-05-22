import { type Finding, parseJsTs } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { typescriptInsertSecretPresenceCheck } from "../../src/fix/typescript-insert-secret-presence-check.js";

const mkFinding = (line: number): Finding => ({
  id: "t:1" as Finding["id"],
  rule_id: "stripe/missing-secret-presence-check",
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

describe("typescriptInsertSecretPresenceCheck", () => {
  it("inserts a guard above process.env.WEBHOOK_SECRET usage", async () => {
    const src = "function h() {\n  const sig = process.env.WEBHOOK_SECRET;\n}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptInsertSecretPresenceCheck(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.after).toContain(
      'if (!process.env.WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET is not set")',
    );
  });

  it("returns null when the line doesn't reference process.env", async () => {
    const src = "const x = 1;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptInsertSecretPresenceCheck(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when a guard already exists on the previous line", async () => {
    const src =
      "if (!process.env.WEBHOOK_SECRET) throw new Error('x');\nconst sig = process.env.WEBHOOK_SECRET;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptInsertSecretPresenceCheck(parsed, mkFinding(2))).toBeNull();
  });
});
