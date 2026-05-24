import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REAL_ROOT = join(__dirname, "..");

const FIXED_GROUP = [
  "@hookwarden/engine",
  "@hookwarden/rules",
  "@hookwarden/fix",
  "@hookwarden/github-action",
  "hookwarden",
  "hook-warden",
  "hookwardn",
  "hookwardne",
  "hookwardens",
  "hookwarden-cli",
];

const PKG_PATHS: Record<string, string> = {
  "@hookwarden/engine": "packages/engine/package.json",
  "@hookwarden/rules": "packages/rules/package.json",
  "@hookwarden/fix": "packages/fix/package.json",
  "@hookwarden/github-action": "packages/github-action/package.json",
  hookwarden: "packages/cli/package.json",
  "hook-warden": "packages/typo-shims/hook-warden/package.json",
  hookwardn: "packages/typo-shims/hookwardn/package.json",
  hookwardne: "packages/typo-shims/hookwardne/package.json",
  hookwardens: "packages/typo-shims/hookwardens/package.json",
  "hookwarden-cli": "packages/typo-shims/hookwarden-cli/package.json",
};

// Sandbox: copy each fixed-group package.json + the .changeset config into a tmp tree.
// changeset version operates on tmp; real working tree is never touched.
const SANDBOX = mkdtempSync(join(tmpdir(), "changeset-fixed-group-"));

function setupSandbox() {
  // Copy package.json files into sandbox preserving directory structure
  for (const rel of Object.values(PKG_PATHS)) {
    const src = join(REAL_ROOT, rel);
    const dst = join(SANDBOX, rel);
    mkdirSync(join(SANDBOX, rel.replace("/package.json", "")), { recursive: true });
    cpSync(src, dst);
  }
  // Copy .changeset config (so changeset version sees the fixed group definition)
  mkdirSync(join(SANDBOX, ".changeset"), { recursive: true });
  cpSync(join(REAL_ROOT, ".changeset/config.json"), join(SANDBOX, ".changeset/config.json"));
  // Minimal sandbox package.json so changeset CLI treats it as a workspace root
  writeFileSync(
    join(SANDBOX, "package.json"),
    JSON.stringify(
      {
        name: "sandbox-root",
        private: true,
        workspaces: ["packages/*", "packages/typo-shims/*"],
      },
      null,
      2,
    ),
  );
  // Minimal pnpm-workspace.yaml so changeset's pnpm-aware logic sees the workspace
  writeFileSync(
    join(SANDBOX, "pnpm-workspace.yaml"),
    "packages:\n  - 'packages/*'\n  - 'packages/typo-shims/*'\n",
  );
}

function readVersion(rel: string, root = SANDBOX): string {
  return JSON.parse(readFileSync(join(root, rel), "utf8")).version;
}

function pkgPath(name: string): string {
  const rel = PKG_PATHS[name];
  if (!rel) throw new Error(`unknown package in fixed group: ${name}`);
  return rel;
}

setupSandbox();
const initialVersions: Record<string, string> = Object.fromEntries(
  FIXED_GROUP.map((name) => [name, readVersion(pkgPath(name))]),
);

afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

describe("Changesets fixed group bumps all 10 packages in lockstep", () => {
  it("plants a patch changeset on hookwarden and verifies all 10 packages bump to the same version", () => {
    const changeset = `---
"hookwarden": patch
---

Test changeset for fixed-group lockstep verification (sandbox only).
`;
    writeFileSync(join(SANDBOX, ".changeset/fixed-group-test.md"), changeset);

    // Invoke the changeset binary from REAL_ROOT's node_modules but with cwd=SANDBOX
    // so it operates entirely on the sandbox tree. (`changeset version` has no --cwd flag.)
    const changesetBin = join(REAL_ROOT, "node_modules/.bin/changeset");
    execSync(`"${changesetBin}" version`, { cwd: SANDBOX, stdio: "pipe" });

    const newVersions = Object.fromEntries(
      FIXED_GROUP.map((name) => [name, readVersion(pkgPath(name))]),
    );

    const versions = new Set(Object.values(newVersions));
    expect(versions.size, `expected 1 distinct version, got ${[...versions].join(", ")}`).toBe(1);

    const newVersion = [...versions][0];
    expect(newVersion).not.toBe(initialVersions.hookwarden);
    expect(newVersion).toMatch(/^\d+\.\d+\.\d+/);

    // Sanity: the REAL working tree's package.json was NOT touched.
    expect(readVersion(pkgPath("hookwarden"), REAL_ROOT)).toBe(initialVersions.hookwarden);
  });
});
