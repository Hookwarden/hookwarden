import { describe, expect, it } from "vitest";
import { parseJsTs, type Finding } from "@hookwarden/engine";
import { typescriptReplaceReqBodyWithRawBody } from "../../src/fix/typescript-replace-req-body-with-raw-body.js";

const mkFinding = (line: number): Finding => ({
  id: "t:1" as Finding["id"],
  rule_id: "stripe/raw-body-misuse",
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

describe("typescriptReplaceReqBodyWithRawBody", () => {
  it("rewrites req.body → req.rawBody", async () => {
    const src = "function handler(req) {\n  return hmacOf(req.body);\n}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptReplaceReqBodyWithRawBody(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.before).toBe("req.body");
    expect(fix!.after).toBe("req.rawBody");
  });

  it("preserves the object source expression (e.g., this.req.body)", async () => {
    const src = "class H {\n  handle() { return hmacOf(this.req.body); }\n}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const fix = typescriptReplaceReqBodyWithRawBody(parsed, mkFinding(2));
    expect(fix).not.toBeNull();
    expect(fix!.after).toBe("this.req.rawBody");
  });

  it("returns null when no req.body member access on the line", async () => {
    const src = "const x = 1;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptReplaceReqBodyWithRawBody(parsed, mkFinding(1))).toBeNull();
  });

  it("returns null when already using .rawBody", async () => {
    const src = "function h(req) {\n  return hmacOf(req.rawBody);\n}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(typescriptReplaceReqBodyWithRawBody(parsed, mkFinding(2))).toBeNull();
  });
});
