// Plan 23-05 Task 1 Tests 1-5 + Test 7 — scan_handler input validation.
//
// Each negative shape from D-23-08 must return `isError: true` with a
// structured error payload — never throw past the tool boundary.

import { describe, expect, it } from "vitest";

import { scanHandler } from "../../src/tools/scan-handler.js";
import type { BuildManifest, ScanHandlerInput } from "../../src/types.js";
import { loadBuildManifest } from "../../src/drift-check.js";

// Use the just-emitted manifest so drift doesn't fire and we exercise the
// input-validation branch. Build runs before tests via the verify gate.
let manifest: BuildManifest;
async function getManifest(): Promise<BuildManifest> {
  if (!manifest) manifest = await loadBuildManifest();
  return manifest;
}

describe("scan_handler input validation (Tests 1-5 + 7)", () => {
  it("Test 1: empty input → isError:true with error:'empty_input'", async () => {
    const m = await getManifest();
    const result = await scanHandler({} as ScanHandlerInput, m);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toBe("empty_input");
  });

  it("Test 2: code AND files → exclusive_input_modes", async () => {
    const m = await getManifest();
    const result = await scanHandler(
      { code: "x", files: { "a.ts": "y" } } as ScanHandlerInput,
      m,
    );
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toBe("exclusive_input_modes");
  });

  it("Test 3: language:'php' → language_not_in_preview with CLI suggestion", async () => {
    const m = await getManifest();
    const result = await scanHandler({ code: "x", language: "php" } as ScanHandlerInput, m);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toBe("language_not_in_preview");
    expect((result.structuredContent as { suggestion: string }).suggestion).toMatch(
      /PHP support ships in v0\.8\.1.*npx hookwarden scan/,
    );
  });

  it("Test 4: language:'ruby' → unsupported_language", async () => {
    const m = await getManifest();
    const result = await scanHandler(
      // biome-ignore lint/suspicious/noExplicitAny: testing rejection of unknown language
      { code: "x", language: "ruby" as any } as ScanHandlerInput,
      m,
    );
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toBe("unsupported_language");
  });

  it("Test 5: provider:'bogus' → unknown_provider with sorted known list", async () => {
    const m = await getManifest();
    const result = await scanHandler({ code: "x", provider: "bogus" }, m);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toBe("unknown_provider");
    const known = (result.structuredContent as { known: string[] }).known;
    expect(known.length).toBeGreaterThan(0);
    expect([...known].sort()).toEqual(known); // sorted
  });

  it("Test 7 (shape): error returns include both structuredContent AND content[1] with JSON.stringify match", async () => {
    const m = await getManifest();
    const result = await scanHandler({} as ScanHandlerInput, m);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("text");
    expect(result.content[1].type).toBe("text");
    expect(JSON.parse(result.content[1].text)).toEqual(result.structuredContent);
  });
});
