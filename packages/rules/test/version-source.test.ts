import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES_PACK_VERSION } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
  version: string;
};

describe("RULES_PACK_VERSION (D-05 drift gate)", () => {
  it("matches the version field in package.json (no drift)", () => {
    expect(RULES_PACK_VERSION).toBe(pkg.version);
  });

  it("is a valid semver MAJOR.MINOR.PATCH string", () => {
    expect(RULES_PACK_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  });
});
