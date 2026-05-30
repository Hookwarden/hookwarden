// Plan 23-05 Task 2 — Tool.result dual-shape contract.
//
// Per RESEARCH §Pitfall 5 + MCP spec 2025-06-18: every scan_handler response
// MUST include BOTH `structuredContent` (first-class) AND a companion
// stringified-JSON text block in `content[]` (backwards-compat for clients
// that don't surface structuredContent yet).

import { describe, expect, it } from "vitest";

import { loadBuildManifest } from "../../src/drift-check.js";
import { scanHandler } from "../../src/tools/scan-handler.js";

describe("Tool.result dual-shape contract (Plan 23-05 T2 Test 1)", () => {
  it("clean scan: structuredContent populated AND content[1] is JSON.stringify(structuredContent)", async () => {
    const manifest = await loadBuildManifest();
    const result = await scanHandler({ code: "// no-op handler", language: "ts" }, manifest);

    // structuredContent first-class
    expect(result.structuredContent).toBeTypeOf("object");
    expect(result.structuredContent).not.toBeNull();

    // content[] has at least the human one-liner + the stringified-JSON block
    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toMatch(/hookwarden scan_handler/);

    expect(result.content[1].type).toBe("text");
    const parsed = JSON.parse(result.content[1].text);
    expect(parsed).toEqual(result.structuredContent);
  });

  it("error path also satisfies dual-shape (negative coverage)", async () => {
    const manifest = await loadBuildManifest();
    // Trigger validation error: code AND files both set.
    const result = await scanHandler({ code: "x", files: { "a.ts": "y" } }, manifest);

    expect(result.isError).toBe(true);
    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(result.content[1].text)).toEqual(result.structuredContent);
  });
});
