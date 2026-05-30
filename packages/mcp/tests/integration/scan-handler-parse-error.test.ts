// Plan 23-05 Task 1 Tests 10 + 11 + 12 — parse error + redaction + drift.
//
// Parse failures are findings, NOT transport crashes (D-23-06 + ENGINE-07).
// Secret literals in the source are redacted by the engine; scan-handler
// passes Finding.message verbatim (D-23-07).
// Call-time drift gate (D-23-12) returns isError:true with the same 4-field
// payload Plan 23-02 boot-time gate emits.

import { describe, expect, it } from "vitest";

import { loadBuildManifest } from "../../src/drift-check.js";
import { scanHandler } from "../../src/tools/scan-handler.js";
import type { BuildManifest } from "../../src/types.js";

describe("scan_handler — parse error surfaces as finding (Test 10)", () => {
  it("syntactically broken JS produces a parse-error finding, NOT a transport crash", async () => {
    const manifest = await loadBuildManifest();
    const result = await scanHandler({ code: "function ( {", language: "ts" }, manifest);

    // The handler must not throw — parse errors are findings.
    expect(result.isError).toBeFalsy();

    const structuredContent = result.structuredContent as {
      verdict_summary: { parse_error: number };
      findings: Array<{ rule_id: string; severity: string }>;
    };

    expect(structuredContent.verdict_summary.parse_error).toBeGreaterThan(0);
    const parseErrors = structuredContent.findings.filter(
      (f) => f.rule_id === "engine/parse-error" || f.rule_id === "parse-error",
    );
    expect(parseErrors.length).toBeGreaterThan(0);
  });
});

describe("scan_handler — secret redaction preserved (Test 11)", () => {
  it("does not echo whsec_test_… literal in any finding message", async () => {
    const manifest = await loadBuildManifest();
    const code = `
      // Handler that mentions a secret literal in source — engine should redact it.
      const webhookSecret = "whsec_test_abc123sensitive";
      export function handle(req, res) {
        // process without verification
        res.json({ received: true });
      }
    `;
    const result = await scanHandler({ code, language: "ts" }, manifest);

    const structuredContent = result.structuredContent as {
      findings: Array<{ message: string }>;
    };
    const messages = structuredContent.findings.map((f) => f.message).join("\n");
    expect(messages).not.toContain("whsec_test_abc123sensitive");
  });
});

describe("scan_handler — call-time drift gate (Test 12)", () => {
  it("synthetic manifest with engine.version='9.99.99' → engine_drift isError:true", async () => {
    const fakeManifest: BuildManifest = {
      engine: { version: "9.99.99", content_hash: null },
      rules: { version: "9.99.99", content_hash: "0".repeat(64) },
      built_at: "2026-05-30T00:00:00Z",
    };

    const result = await scanHandler({ code: "x", language: "ts" }, fakeManifest);

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      error: string;
      component: string;
      pinned: string;
      current: string;
      suggestion: string;
      rationale: string;
    };
    expect(sc.error).toBe("engine_drift");
    expect(sc.component).toBe("engine");
    expect(sc.pinned).toBe("9.99.99");
    expect(sc.current).toBe("0.7.0");
    expect(sc.suggestion).toContain("npm i -g @hookwarden/mcp@latest");
    expect(sc.rationale.length).toBeGreaterThan(0);
  });
});
