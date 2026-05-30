// Plan 23-04 Task 2 — PC-MCP-1..6 tarball-shape assertions.
//
// Catches package.json files: array drift (e.g., someone drops "wasm" from
// the allowlist and the tarball ships without the parser grammar; runtime
// loadPythonWasmBytes() fails with ENOENT). npm pack --dry-run --json is
// the source-of-truth for what publish-time would emit.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..");
const PKG_JSON = path.join(PKG_ROOT, "package.json");

interface NpmPackEntry {
  readonly files?: ReadonlyArray<{ readonly path: string }>;
}
interface PackageJson {
  readonly files?: ReadonlyArray<string>;
  readonly dependencies?: Readonly<Record<string, string>>;
}

const ALLOWED_DEPS = new Set([
  "@hookwarden/engine",
  "@hookwarden/rules",
  "@modelcontextprotocol/sdk",
  "web-tree-sitter",
  "citty",
  "picocolors",
  "zod",
]);

function npmPackPaths(): string[] {
  const json = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: PKG_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(json) as ReadonlyArray<NpmPackEntry>;
  return parsed.flatMap((p) => p.files ?? []).map((f) => f.path);
}

describe("pack-contents — published tarball shape (PC-MCP-1..6)", () => {
  const paths = npmPackPaths();
  const pkg = JSON.parse(readFileSync(PKG_JSON, "utf-8")) as PackageJson;

  it("PC-MCP-1: includes wasm/tree-sitter-python.wasm", () => {
    expect(paths).toContain("wasm/tree-sitter-python.wasm");
  });

  it("PC-MCP-2: includes dist/build-manifest.json", () => {
    expect(paths).toContain("dist/build-manifest.json");
  });

  it("PC-MCP-3: includes LICENSE", () => {
    expect(paths).toContain("LICENSE");
  });

  it("PC-MCP-4: includes server.json", () => {
    expect(paths).toContain("server.json");
  });

  it("PC-MCP-5: package.json#files array contains 'wasm'", () => {
    expect(pkg.files ?? []).toContain("wasm");
  });

  it("PC-MCP-6: package.json#dependencies keys are a subset of the 7-pkg allowlist", () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const dep of deps) {
      expect(ALLOWED_DEPS).toContain(dep);
    }
  });
});
