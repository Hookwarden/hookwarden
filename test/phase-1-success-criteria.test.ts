import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SC2_FIXTURE = join(ROOT, "packages/engine/src/__sc2-fixture.ts");

function run(cmd: string, opts: { allowFail?: boolean } = {}): { code: number; output: string } {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    const result = {
      code: err.status ?? 1,
      output: (err.stdout ?? "") + (err.stderr ?? ""),
    };
    if (opts.allowFail) return result;
    throw new Error(`Command failed: ${cmd}\n${result.output}`);
  }
}

afterEach(() => {
  if (existsSync(SC2_FIXTURE)) unlinkSync(SC2_FIXTURE);
});

describe("Phase 1 — Foundation & Defensive Registration: Success Criteria", () => {
  it("Success Criterion 1: TS project references resolve and 4 OSS package dirs exist", () => {
    run("pnpm exec tsc --build --dry");
    for (const name of ["engine", "cli", "github-action", "rules"]) {
      const path = join(ROOT, "packages", name, "package.json");
      expect(existsSync(path), `packages/${name}/package.json missing`).toBe(true);
    }
    const root = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8"));
    expect(root.references.length).toBe(4);
  });

  it("Success Criterion 2: dep-cruiser blocks fs import in packages/engine", () => {
    writeFileSync(SC2_FIXTURE, "import 'fs';\nexport const x = 1;\n");
    const { code, output } = run("pnpm purity", { allowFail: true });
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
  });

  it("Success Criterion 3: bundle inspector behavioral suite passes", () => {
    run("pnpm --filter hookwarden test");
  }, 60_000);

  it("Success Criterion 4: defensive registration verifier passes for all claimed identities", () => {
    run("bash scripts/verify-defensive-registration.sh");
  }, 60_000);

  it("Success Criterion 5: Changesets fixed group bumps all 9 packages in lockstep", () => {
    run("pnpm exec vitest run test/changeset-fixed-group.test.ts");
  }, 60_000);
});
