import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CLI_ROOT = join(__dirname, "..");
const PKG_JSON = join(CLI_ROOT, "package.json");
// Fixtures live in dist/ (which IS in the `files` field — visible to npm pack)
// and test/ (which is NOT in `files` — invisible). The inspector walks the tarball,
// so a fixture must land in dist/ for the gate to see it.
const DIST_FIXTURE = join(CLI_ROOT, "dist/__inspector-fixture.js");
const TEST_FIXTURE = join(CLI_ROOT, "test/__inspector-fixture.ts");

function inspect(): { code: number; output: string } {
  try {
    const out = execSync("pnpm exec tsx scripts/inspect-bundle.ts", {
      cwd: CLI_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

function withPkgEdit(edit: (pkg: Record<string, unknown>) => void, fn: () => void) {
  const original = readFileSync(PKG_JSON, "utf8");
  try {
    const pkg = JSON.parse(original);
    edit(pkg);
    writeFileSync(PKG_JSON, `${JSON.stringify(pkg, null, 2)}\n`);
    fn();
  } finally {
    writeFileSync(PKG_JSON, original);
  }
}

afterEach(() => {
  for (const f of [DIST_FIXTURE, TEST_FIXTURE]) {
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("inspect-bundle gate", () => {
  it("passes on clean scaffold", () => {
    const { code } = inspect();
    expect(code).toBe(0);
  });

  it("rejects packages with a postinstall script", () => {
    withPkgEdit(
      (p) => {
        (p.scripts as Record<string, string>) = {
          ...((p.scripts as object) || {}),
          postinstall: "echo evil",
        };
      },
      () => {
        const { code, output } = inspect();
        expect(code).not.toBe(0);
        expect(output).toMatch(/postinstall/);
      },
    );
  });

  it("rejects axios import in dist (published bundle)", () => {
    writeFileSync(DIST_FIXTURE, "import 'axios';\nexport const x = 1;\n");
    const { code, output } = inspect();
    expect(code).not.toBe(0);
    expect(output).toMatch(/axios/);
  });

  it("rejects node:http import in dist (published bundle)", () => {
    writeFileSync(DIST_FIXTURE, "import 'node:http';\nexport const x = 1;\n");
    const { code, output } = inspect();
    expect(code).not.toBe(0);
    expect(output).toMatch(/network-builtin/);
  });

  it("rejects @sentry/node import in dist (published bundle)", () => {
    writeFileSync(DIST_FIXTURE, "import '@sentry/node';\nexport const x = 1;\n");
    const { code, output } = inspect();
    expect(code).not.toBe(0);
    expect(output).toMatch(/analytics-sdk/);
  });

  it("does NOT inspect files excluded from the published tarball (test/ is not in files[])", () => {
    writeFileSync(TEST_FIXTURE, "import 'axios';\nexport const x = 1;\n");
    const { code } = inspect();
    expect(code).toBe(0);
  });
});
