import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

// Fixture paths — one per package where a purity invariant lives.
const ENGINE_FIXTURE = join(ROOT, "packages/engine/src/__purity-fixture.ts");
const CLI_FIXTURE = join(ROOT, "packages/cli/src/__test-fixture.ts");
const RULES_PREDICATE_FIXTURE = join(ROOT, "packages/rules/src/predicates/__purity-fixture.ts");
const FIX_FIXTURE = join(ROOT, "packages/fix/src/__purity-fixture.ts");

const ALL_FIXTURES = [ENGINE_FIXTURE, CLI_FIXTURE, RULES_PREDICATE_FIXTURE, FIX_FIXTURE];

let DEPCRUISER_CONFIG_SRC = "";

function depcruise(): { code: number; output: string } {
  try {
    const out = execSync("pnpm exec depcruise --config .dependency-cruiser.cjs packages", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, output: out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

beforeAll(() => {
  DEPCRUISER_CONFIG_SRC = readFileSync(join(ROOT, ".dependency-cruiser.cjs"), "utf8");
});

afterEach(() => {
  for (const f of ALL_FIXTURES) {
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("dep-cruiser engine purity rules", () => {
  // ─── Live rule-fires (deps actually resolvable from the fixture's package) ─

  it("baseline: clean engine passes depcruise", () => {
    const { code } = depcruise();
    expect(code).toBe(0);
  });

  it("engine-no-node-core: rejects fs import in packages/engine/src", () => {
    writeFileSync(ENGINE_FIXTURE, "import 'fs';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
  });

  it("engine-no-node-core: rejects node:child_process import", () => {
    writeFileSync(ENGINE_FIXTURE, "import 'node:child_process';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
  });

  it("engine-no-node-core: rejects node:path import", () => {
    writeFileSync(ENGINE_FIXTURE, "import 'node:path';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
  });

  it("engine-no-node-core: rejects node:http import", () => {
    writeFileSync(ENGINE_FIXTURE, "import 'node:http';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
  });

  it("engine-no-node-core: rejects node:url import", () => {
    writeFileSync(ENGINE_FIXTURE, "import 'node:url';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
  });

  it("engine-no-network-libs: rejects axios import in packages/engine/src", () => {
    writeFileSync(ENGINE_FIXTURE, "import 'axios';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-network-libs/);
  });

  it("rules-predicates-no-node-core: rejects fs import in rules/predicates", () => {
    writeFileSync(RULES_PREDICATE_FIXTURE, "import 'fs';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/rules-predicates-no-node-core/);
  });

  it("rules-predicates-no-node-core: rejects node:child_process in rules/predicates", () => {
    writeFileSync(RULES_PREDICATE_FIXTURE, "import 'node:child_process';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/rules-predicates-no-node-core/);
  });

  it("rules-predicates-no-network-libs: rejects axios in rules/predicates", () => {
    writeFileSync(RULES_PREDICATE_FIXTURE, "import 'axios';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/rules-predicates-no-network-libs/);
  });

  it("fix-no-network-libs: rejects axios import in packages/fix/src", () => {
    writeFileSync(FIX_FIXTURE, "import 'axios';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/fix-no-network-libs/);
  });

  // ─── Config-presence assertions (rules we can't exercise via fixture because
  //     the deps aren't resolvable from the rule's `from:` scope under pnpm
  //     strict layout, but whose existence + shape we still want to lock down).

  it("config: engine-no-fs-libs rule exists with the expected fs-lib list", () => {
    expect(DEPCRUISER_CONFIG_SRC).toMatch(/name:\s*"engine-no-fs-libs"/);
    // Each named fs-lib must be present in the regex; if someone drops one
    // (e.g. chokidar), this test fires.
    for (const lib of [
      "graceful-fs",
      "fs-extra",
      "memfs",
      "chokidar",
      "glob",
      "fast-glob",
      "tinyglobby",
    ]) {
      expect(DEPCRUISER_CONFIG_SRC, `engine-no-fs-libs must include ${lib}`).toContain(lib);
    }
  });

  it("config: engine-no-babel-traverse rule exists with both babel mutation deps", () => {
    expect(DEPCRUISER_CONFIG_SRC).toMatch(/name:\s*"engine-no-babel-traverse"/);
    expect(DEPCRUISER_CONFIG_SRC).toMatch(/@babel\/traverse/);
    expect(DEPCRUISER_CONFIG_SRC).toMatch(/@babel\/generator/);
  });

  it("config: rules-no-babel-traverse rule exists scoped to rules/src/predicates", () => {
    // Slice a generous window after the rule name to capture from: + to: clauses.
    const idx = DEPCRUISER_CONFIG_SRC.indexOf('name: "rules-no-babel-traverse"');
    expect(idx).toBeGreaterThan(-1);
    const ruleWindow = DEPCRUISER_CONFIG_SRC.slice(idx, idx + 600);
    expect(ruleWindow).toMatch(/packages\/rules\/src\/predicates\//);
    expect(ruleWindow).toMatch(/@babel\/traverse/);
    expect(ruleWindow).toMatch(/@babel\/generator/);
  });

  it("config: every forbidden rule has severity 'error' (not 'warn')", () => {
    // Match every `name: "..."` block and assert each has severity "error" within
    // a reasonable window. Any new rule added with severity "warn" would slip
    // past CI — this test fires.
    const ruleNames = [...DEPCRUISER_CONFIG_SRC.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ruleNames.length).toBeGreaterThanOrEqual(8);
    for (const name of ruleNames) {
      const ruleSection = DEPCRUISER_CONFIG_SRC.slice(
        DEPCRUISER_CONFIG_SRC.indexOf(`name: "${name}"`),
      ).slice(0, 200);
      expect(ruleSection, `rule '${name}' must have severity 'error'`).toMatch(
        /severity:\s*"error"/,
      );
    }
  });

  it("config: total forbidden-rule count matches the documented architecture (10 rules)", () => {
    const ruleCount = (DEPCRUISER_CONFIG_SRC.match(/name:\s*"[^"]+"/g) ?? []).length;
    expect(ruleCount).toBe(10);
  });

  // ─── Re-export proxy bypass tests (engine-no-cli-imports) ────────────────
  // Without engine-no-cli-imports, the chain `engine/src/proxy.ts -> cli/src/x.ts`
  // would not trigger engine-no-node-core even when x.ts imports fs (because
  // the fs import lives in cli, where it's an allowed carve-out). These tests
  // prove the new rule closes that bypass.

  it("engine-no-cli-imports: rejects relative import from engine/src to packages/cli", () => {
    writeFileSync(
      ENGINE_FIXTURE,
      "import { something } from '../../cli/src/index.js';\nexport const x = 1;\n",
    );
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-cli-imports/);
  });

  it("engine-no-cli-imports: rejects re-export-proxy chain (engine -> cli)", () => {
    // The actual bypass scenario: a proxy file re-exporting from cli would
    // smuggle cli's allowed-fs deps into engine's runtime path without firing
    // engine-no-node-core. engine-no-cli-imports closes that escape hatch.
    writeFileSync(ENGINE_FIXTURE, "export * from '../../cli/src/index.js';\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-cli-imports/);
  });

  it("rules-predicates-no-cli-imports: rejects relative import from rules/predicates to cli", () => {
    writeFileSync(
      RULES_PREDICATE_FIXTURE,
      "import { something } from '../../../cli/src/index.js';\nexport const x = 1;\n",
    );
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/rules-predicates-no-cli-imports/);
  });

  it("config: engine-no-cli-imports + rules-predicates-no-cli-imports both exist", () => {
    expect(DEPCRUISER_CONFIG_SRC).toMatch(/name:\s*"engine-no-cli-imports"/);
    expect(DEPCRUISER_CONFIG_SRC).toMatch(/name:\s*"rules-predicates-no-cli-imports"/);
  });

  // ─── Carve-outs: legitimate boundaries that MUST pass ────────────────────

  it("carve-out: CLI is the I/O boundary — allows fs import in packages/cli/src", () => {
    writeFileSync(CLI_FIXTURE, "import 'fs';\nexport const x = 1;\n");
    const { code } = depcruise();
    expect(code).toBe(0);
  });

  it("carve-out: CLI allows node:path import", () => {
    writeFileSync(CLI_FIXTURE, "import 'node:path';\nexport const x = 1;\n");
    const { code } = depcruise();
    expect(code).toBe(0);
  });

  it("carve-out: CLI allows axios (no engine-no-network-libs rule applies to CLI)", () => {
    writeFileSync(CLI_FIXTURE, "import 'axios';\nexport const x = 1;\n");
    const { code } = depcruise();
    expect(code).toBe(0);
  });

  // ─── Failure-mode tests: gate behaviour under simultaneous violations ────

  it("reports all simultaneous violations across packages, not just the first", () => {
    writeFileSync(ENGINE_FIXTURE, "import 'fs';\nexport const x = 1;\n");
    writeFileSync(RULES_PREDICATE_FIXTURE, "import 'axios';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
    expect(output).toMatch(/rules-predicates-no-network-libs/);
  });

  it("reports two distinct rules firing on the same fixture file", () => {
    // Single fixture violating BOTH engine-no-node-core (fs) AND
    // engine-no-network-libs (axios) — both rule names must appear.
    writeFileSync(ENGINE_FIXTURE, "import 'fs';\nimport 'axios';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
    expect(output).toMatch(/engine-no-network-libs/);
  });
});
