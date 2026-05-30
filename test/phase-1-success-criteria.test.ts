import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SC2_FIXTURE = join(ROOT, "packages/engine/src/__sc2-fixture.ts");

// Some of these checks shell out to a nested `vitest run` (e.g. the bundle
// inspector's `pnpm --filter hookwarden test`). Vitest 4 tightened worker/pool
// handling: if the child inherits the parent run's VITEST_* env it can collide
// with the outer pool and intermittently collect 0 tests (a flaky "FAIL … 0
// test"). Strip VITEST_* so the nested process starts as a clean top-level run.
function cleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env) as [string, string | undefined][]) {
    if (!k.startsWith("VITEST")) env[k] = v;
  }
  return env;
}

function run(cmd: string, opts: { allowFail?: boolean } = {}): { code: number; output: string } {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanEnv(),
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
  it("Success Criterion 1: TS project references resolve and all OSS package dirs exist", () => {
    run("pnpm exec tsc --build --dry");
    // pr-renderer added in phase 8 (08-02) as the canonical home of the PR
    // sticky-comment renderer — shared between @hookwarden/github-action (this
    // repo) and the SaaS continuous-scanning worker (private repo via npm).
    // fix added in phase 8.2 — bounded location for @babel/traverse +
    // @babel/generator (D-05); engine stays pure.
    // mcp added in phase 23 (v0.8) — Model Context Protocol server exposing
    // scan_handler for AI coding agents (Claude Desktop / Cursor / Continue /
    // Anthropic Agent SDK); pinned engine + rules deps for drift detection.
    for (const name of ["engine", "cli", "github-action", "rules", "pr-renderer", "fix", "mcp"]) {
      const path = join(ROOT, "packages", name, "package.json");
      expect(existsSync(path), `packages/${name}/package.json missing`).toBe(true);
    }
    const root = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8"));
    // Bump this count whenever a new packages/* project reference lands in
    // the root tsconfig.json — see packages list above.
    expect(root.references.length).toBe(7);
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

  it("Success Criterion 5: Changesets fixed group bumps all 10 packages in lockstep", () => {
    run("pnpm exec vitest run test/changeset-fixed-group.test.ts");
  }, 60_000);
});
