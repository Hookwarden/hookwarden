import { describe, expect, it } from "vitest";
import { main } from "../src/index.js";

describe("CLI placeholder (Phase 2 API conformance)", () => {
  it("main(argv) returns 0 against the new engine API surface", async () => {
    const code = await main([]);
    expect(code).toBe(0);
  });
});
