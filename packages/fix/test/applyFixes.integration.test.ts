// Phase 8.2 Plan 08 Task 3: applyFixes integration tests.
// Focused on the load-bearing safety contracts: D-12 typed-error throw + the
// three-mode dispatch + happy-path codegen invocation.

import { type Finding, parseJsTs, type RuleSet, type ScanResult } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import {
  applyFixes,
  type CodegenRoutine,
  dryRunFixes,
  FixModeNonTtyRejectedError,
} from "../src/index.js";

const STRIPE_RULE_ID = "stripe/timing-unsafe-comparison";

function mkScan(findings: ReadonlyArray<Finding>): ScanResult {
  return {
    findings,
    inventory: [],
    metadata: {
      engine_version: "0.0.0",
      engine_commit_sha: null,
      rule_pack_version: "0.0.0",
      rule_pack_content_hash: "sha256:0",
      scanned_at: "2026-05-22T00:00:00.000Z",
      parse_errors_count: 0,
      parsed_files_count: 1,
      total_files_count: 1,
      parse_candidates_count: 1,
    },
  };
}

function mkFinding(line: number, ruleId = STRIPE_RULE_ID): Finding {
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
    message: "",
    metadata: {},
  };
}

function mkRuleSet(safety: "safe" | "unsafe" | "manual-only"): RuleSet {
  return {
    schema_version: 1,
    rule_pack_version: "0.0.0",
    providers: {},
    rules: [
      {
        rule_id: STRIPE_RULE_ID,
        provider: "stripe",
        severity: "critical",
        emits_state: "not-verified",
        message: "test",
        matcher: null,
        predicate_name: "stripe-timing-unsafe-comparison",
        applies_to: ["express"],
        provider_docs_url: "https://stripe.com/docs/webhooks/signatures",
        path_severity_overrides: null,
        fix: {
          safety,
          description: "Replace === with crypto.timingSafeEqual(...)",
          codegen: safety === "manual-only" ? null : "typescript-replace-binary-equality",
        },
      },
    ],
    predicates: {},
  };
}

describe("applyFixes — D-12 typed-error contract (W7)", () => {
  it("throws FixModeNonTtyRejectedError when mode=all + non-TTY + !acceptUnsafe", async () => {
    const scan = mkScan([]);
    const ruleSet = mkRuleSet("safe");
    try {
      await applyFixes(scan, ruleSet, { mode: "all", write: false, isTty: false });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(FixModeNonTtyRejectedError);
      expect((e as FixModeNonTtyRejectedError).code).toBe("FIX_MODE_NON_TTY_REJECTED");
    }
  });

  it("does NOT throw when mode=all + acceptUnsafe", async () => {
    const scan = mkScan([]);
    const ruleSet = mkRuleSet("safe");
    await expect(
      applyFixes(scan, ruleSet, {
        mode: "all",
        write: false,
        isTty: false,
        acceptUnsafe: true,
      }),
    ).resolves.toBeDefined();
  });

  it("does NOT throw when mode=all + isTty", async () => {
    const scan = mkScan([]);
    const ruleSet = mkRuleSet("safe");
    await expect(
      applyFixes(scan, ruleSet, { mode: "all", write: false, isTty: true }),
    ).resolves.toBeDefined();
  });
});

describe("applyFixes — three-mode safety dispatch", () => {
  it("mode=safe skips findings whose rule has safety: unsafe", async () => {
    const scan = mkScan([mkFinding(1)]);
    const unsafeRuleSet = mkRuleSet("unsafe");
    const result = await applyFixes(scan, unsafeRuleSet, { mode: "safe", write: false });
    expect(result.fixes).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("mode=manual-only-explain surfaces manual-only findings as text-only edits", async () => {
    const scan = mkScan([mkFinding(1)]);
    const manualRuleSet = mkRuleSet("manual-only");
    const result = await applyFixes(scan, manualRuleSet, {
      mode: "manual-only-explain",
      write: false,
    });
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]?.safety).toBe("manual-only");
    expect(result.fixes[0]?.after).toContain("timingSafeEqual");
  });
});

describe("dryRunFixes — codegen invocation via injected registry", () => {
  it("invokes the codegen for safety:safe findings; returns a populated FixResult", async () => {
    const src = "if (expected === sig) {}\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const scan = mkScan([mkFinding(1)]);
    const ruleSet = mkRuleSet("safe");

    // Synthetic codegen that mirrors the real typescript-replace-binary-equality.
    const stubCodegen: CodegenRoutine = (parsedFile, finding) => {
      const startByte = src.indexOf("expected === sig");
      return {
        ruleId: finding.rule_id,
        routineId: "typescript-replace-binary-equality",
        filePath: parsedFile.file_path,
        startByte,
        endByte: startByte + "expected === sig".length,
        start: { line: 1, col: 1 },
        end: { line: 1, col: 1 },
        before: "expected === sig",
        after: "crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))",
        safety: "safe",
      };
    };

    const result = await dryRunFixes(
      scan,
      ruleSet,
      { mode: "safe" },
      {
        parsedFiles: { "x.ts": parsed },
        codegenRegistry: { "typescript-replace-binary-equality": stubCodegen },
      },
    );
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]?.after).toContain("crypto.timingSafeEqual");
  });
});
