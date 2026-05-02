import { describe, expect, it } from "vitest";
import { buildParseErrorFinding } from "../../src/evaluator/parse-error.js";
import { parseJsTs } from "../../src/parsers/babel.js";

describe("buildParseErrorFinding (D-27 + ENGINE-07)", () => {
  it("creates a single finding with rule_id engine/parse-error, severity high, state manual-review", async () => {
    const file = await parseJsTs({
      file_path: "src/broken.ts",
      source_text: "const x = ;\nconst y = 1;\n",
    });
    expect(file.parse_error).not.toBeNull();
    const finding = await buildParseErrorFinding(file);
    expect(finding.rule_id).toBe("engine/parse-error");
    expect(finding.severity).toBe("high");
    expect(finding.state).toBe("manual-review");
    expect(finding.handler_id).toBeNull();
    expect(finding.primary_location_line_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(finding.id).toMatch(/^[0-9a-f]{64}$/);
    expect(finding.metadata["source"]).toBe("babel");
  });

  it("throws when called on a clean file", async () => {
    const file = await parseJsTs({ file_path: "ok.ts", source_text: "const x = 1;" });
    await expect(buildParseErrorFinding(file)).rejects.toThrow(/without parse_error/);
  });
});
