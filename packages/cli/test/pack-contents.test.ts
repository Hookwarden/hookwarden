// Warning 10 — assert the published npm tarball does NOT contain test/ paths.
// Catches package.json `files:` array drift (e.g., someone adds "src" or "**/*"
// and accidentally publishes test fixtures + dev artifacts).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PKG_DIR = resolve(__dirname, "..");

describe("pack-contents (Warning 10) — published tarball excludes test/", () => {
  it("PC-1: npm pack --dry-run does not list any test/ paths", () => {
    let parsed: Array<{ files?: Array<{ path: string }> }> | null = null;
    let textListing = "";
    try {
      const json = execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: CLI_PKG_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      parsed = JSON.parse(json) as Array<{ files?: Array<{ path: string }> }>;
    } catch {
      // Fallback: --json unsupported on this npm. Use plain-text listing.
      textListing = execFileSync("npm", ["pack", "--dry-run"], {
        cwd: CLI_PKG_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    if (parsed !== null) {
      const allPaths = parsed.flatMap((p) => p.files ?? []).map((f) => f.path);
      const testPaths = allPaths.filter((p) => /^test\//.test(p));
      expect(testPaths).toEqual([]);
    } else {
      // npm pack --dry-run prints lines like:
      //   npm notice 123B    src/index.js
      //   npm notice 456B    test/fixture.ts   <-- forbidden
      const offending = textListing
        .split(/\r?\n/)
        .filter((line) => /^\s*npm notice\s+[0-9]+(?:\.[0-9]+)?\s*[a-zA-Z]+\s+test\//.test(line));
      expect(offending).toEqual([]);
    }
  });

  it("PC-2: package.json files: array does not include test/", () => {
    const pkg = JSON.parse(readFileSync(join(CLI_PKG_DIR, "package.json"), "utf8")) as {
      files?: ReadonlyArray<string>;
    };
    const files = pkg.files ?? [];
    for (const entry of files) {
      expect(entry).not.toBe("test");
      expect(entry).not.toBe("test/");
      expect(entry).not.toBe("test/**");
      expect(entry).not.toMatch(/^test\//);
    }
  });
});
