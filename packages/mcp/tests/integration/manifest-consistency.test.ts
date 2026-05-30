// Plan 23-04 Task 2 Test 1 — server.json ↔ package.json byte-equality gate.
//
// Per RESEARCH §Pitfall 6: mcp-publisher rejects submissions where
// server.json#name != the package's mcpName field. The byte-equality
// check at CI time catches this before submission rather than during.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..");
const PKG_JSON = path.join(PKG_ROOT, "package.json");
const SERVER_JSON = path.join(PKG_ROOT, "server.json");

interface PackageJson {
  readonly mcpName?: string;
  readonly version: string;
}

interface ServerJson {
  readonly name: string;
  readonly version: string;
  readonly packages: ReadonlyArray<{ readonly identifier: string; readonly version: string }>;
}

describe("manifest-consistency (server.json ↔ package.json)", () => {
  const pkg = JSON.parse(readFileSync(PKG_JSON, "utf-8")) as PackageJson;
  const srv = JSON.parse(readFileSync(SERVER_JSON, "utf-8")) as ServerJson;

  it("package.json#mcpName equals io.github.Hookwarden/mcp", () => {
    expect(pkg.mcpName).toBe("io.github.Hookwarden/mcp");
  });

  it("server.json#name byte-equals package.json#mcpName", () => {
    expect(srv.name).toBe(pkg.mcpName);
  });

  it("server.json#version equals package.json#version", () => {
    expect(srv.version).toBe(pkg.version);
  });

  it("server.json#packages[0].identifier equals @hookwarden/mcp", () => {
    expect(srv.packages[0]?.identifier).toBe("@hookwarden/mcp");
  });

  it("server.json#packages[0].version equals package.json#version", () => {
    expect(srv.packages[0]?.version).toBe(pkg.version);
  });
});
