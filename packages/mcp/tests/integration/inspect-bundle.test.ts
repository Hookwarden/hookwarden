// Plan 23-04 Task 1 Tests — inspect-bundle-mcp negative + positive cases.
//
// Mirrors packages/cli/test/inspect-bundle.test.ts withPkgEdit + DIST_FIXTURE
// mutation patterns. DIST_FIXTURE lands in dist/ (which IS in package.json
// files allowlist → visible to npm pack); the test/ namespace is invisible.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..");
const PKG_JSON = path.join(PKG_ROOT, "package.json");
const DIST_FIXTURE = path.join(PKG_ROOT, "dist", "__inspector-fixture.js");

interface InspectResult {
  readonly code: number;
  readonly output: string;
}

function inspect(): InspectResult {
  try {
    const out = execSync("pnpm exec tsx scripts/inspect-bundle-mcp.ts", {
      cwd: PKG_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

function withPkgEdit(
  edit: (pkg: Record<string, unknown>) => void,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  const original = readFileSync(PKG_JSON, "utf8");
  try {
    const pkg = JSON.parse(original);
    edit(pkg);
    writeFileSync(PKG_JSON, `${JSON.stringify(pkg, null, 2)}\n`);
    return fn();
  } finally {
    writeFileSync(PKG_JSON, original);
  }
}

afterEach(() => {
  if (existsSync(DIST_FIXTURE)) unlinkSync(DIST_FIXTURE);
});

describe("inspect-bundle-mcp gate", () => {
  it("Test 3 (positive): passes on clean built tarball", () => {
    const { code } = inspect();
    expect(code).toBe(0);
  });

  it("Test 1 (negative): synthetic `import 'node:http'` in dist/ → exit non-zero + network-builtin", () => {
    writeFileSync(DIST_FIXTURE, "import http from 'node:http';\nexport const x = 1;\n");
    const { code, output } = inspect();
    expect(code).not.toBe(0);
    expect(output).toMatch(/network-builtin/);
  });

  it("Test 2 (negative): synthetic axios in package.json#dependencies → exit non-zero + deps-allowlist", () => {
    withPkgEdit(
      (p) => {
        (p.dependencies as Record<string, string>) = {
          ...((p.dependencies as object) || {}),
          axios: "1.0.0",
        };
      },
      () => {
        const { code, output } = inspect();
        expect(code).not.toBe(0);
        expect(output).toMatch(/axios.*not on allowlist/i);
      },
    );
  });

  it("Test 4 (positive): @modelcontextprotocol/sdk in dependencies does NOT trigger deps-allowlist", () => {
    // The SDK is in HOOKWARDEN_OWN_PKGS ∪ SDK_TRANSITIVE_ALLOWLIST.
    // Clean build state should already include it; just confirm no violation.
    const { code, output } = inspect();
    expect(code).toBe(0);
    expect(output).not.toMatch(/@modelcontextprotocol\/sdk.*not on allowlist/i);
  });
});
