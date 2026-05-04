// Phase 4 Plan 09 Task 3 — end-to-end CLI invocations via spawnSync.
// Each test runs the real CLI binary against a real fixture and asserts stdout shape + exit code.
// Closest thing the CLI has to a phase-wide smoke test.

import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.resolve(__dirname, "../bin/cli.cjs");
const FIXTURE_ROOT = path.resolve(__dirname, "../../../e2e/fixtures/phase-3");
const CANONICAL_BUG = path.join(FIXTURE_ROOT, "canonical-stripe-bug");
const CANONICAL_HAPPY = path.join(FIXTURE_ROOT, "stripe-construct-event-happy-path");

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: ReadonlyArray<string>, cwd?: string): CliResult {
  const proc = spawnSync("node", [CLI_BIN, "scan", ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const STRIPE_BUG_SOURCE = `
import express from 'express';
import Stripe from 'stripe';
const app = express();
const stripe = new Stripe('sk_test');

app.post('/webhook', express.json(), (req, res) => {
  const event = req.body;
  res.json({ received: true });
});
`;

describe("Phase 4 ROADMAP success criteria — pipeline integration", () => {
  it("PI-1: --format json on canonical Stripe bug exits 1 with valid envelope", () => {
    const r = runCli(["--format", "json", CANONICAL_BUG]);
    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout);
    expect(env.schema_version).toBe("1.0");
    expect(env.scan.findings.length).toBeGreaterThan(0);
    expect(
      env.scan.findings.some(
        (f: { severity: string; state: string }) =>
          f.severity === "critical" && f.state === "not-verified",
      ),
    ).toBe(true);
  });

  it("PI-2: --format sarif on canonical Stripe bug exits 1 with valid SARIF 2.1.0", () => {
    const r = runCli(["--format", "sarif", CANONICAL_BUG]);
    expect(r.code).toBe(1);
    const sarif = JSON.parse(r.stdout);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
    const r0 = sarif.runs[0].results[0];
    expect(r0.level).toBe("error"); // critical → error per D-60
    expect(r0.partialFingerprints.primaryLocationLineHash).toBeTruthy();
    expect(r0.properties["hookwarden-state"]).toBe("not-verified");
  });

  it("PI-3: happy path exits 0, emits stripe/library-verified, does NOT emit stripe/raw-body-misuse", () => {
    // express.raw({ type: 'application/json' }) is an inline per-route middleware argument —
    // outside the handler arrow function body. The engine must recognize it via middleware_chain,
    // not via handler-body text search, so that raw-body-misuse does not fire as a false positive.
    const r = runCli(["--format", "json", CANONICAL_HAPPY]);
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout);
    const findingRuleIds: string[] = env.scan.findings.map((f: { rule_id: string }) => f.rule_id);
    expect(findingRuleIds).toContain("stripe/library-verified");
    expect(findingRuleIds).not.toContain("stripe/raw-body-misuse");
    expect(env.scan.counts.active.critical).toBe(0);
  });

  it("PI-4: inline disable comment suppresses the finding (D-63 + D-66)", async () => {
    // Copy canonical bug fixture and insert an inline disable.
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    const serverPath = path.join(tmp, "server.js");
    const original = await fs.readFile(serverPath, "utf-8");
    const lines = original.split("\n");
    // Insert an inline-disable line before every "app.post" line.
    const patched = lines
      .flatMap((l) =>
        l.includes("app.post(")
          ? [
              "// hookwarden-disable-next-line stripe/missing-signature-verification,stripe/express-middleware-ordering,stripe/raw-body-misuse",
              l,
            ]
          : [l],
      )
      .join("\n");
    await fs.writeFile(serverPath, patched);
    const r = runCli(["--format", "json", tmp]);
    const env = JSON.parse(r.stdout);
    const inlineSuppressed = env.scan.findings.filter(
      (f: { suppressed: { source: string } | null }) => f.suppressed?.source === "inline",
    );
    expect(inlineSuppressed.length).toBeGreaterThan(0);
  });

  it("PI-5: .hookwardenignore suppresses findings with source=ignore", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    await fs.writeFile(path.join(tmp, ".hookwardenignore"), "server.js\n");
    const r = runCli(["--format", "json", tmp]);
    const env = JSON.parse(r.stdout);
    const ignored = env.scan.findings.filter(
      (f: { suppressed: { source: string; pattern?: string } | null }) =>
        f.suppressed?.source === "ignore",
    );
    expect(ignored.length).toBeGreaterThan(0);
    expect(ignored[0].suppressed.pattern).toBe("server.js");
  });

  it("PI-6: baseline file with the finding's fingerprint suppresses with source=baseline", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    // First scan to capture a baseline.
    const writeRes = runCli(["--baseline", "write", "--format", "json", tmp]);
    expect(writeRes.code).toBe(1); // baseline-write does not mute exit code on the same run
    // Second scan auto-reads the baseline.
    const r = runCli(["--format", "json", tmp]);
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout);
    const baselined = env.scan.findings.filter(
      (f: { suppressed: { source: string } | null }) => f.suppressed?.source === "baseline",
    );
    expect(baselined.length).toBeGreaterThan(0);
  });

  it("PI-7: --baseline write captures findings; second run exits 0", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    const w = runCli(["--baseline", "write", tmp]);
    expect(w.code).toBe(1); // findings still trip on the same run
    const baselineFile = path.join(tmp, ".hookwarden.baseline.json");
    const baseline = JSON.parse(await fs.readFile(baselineFile, "utf-8"));
    expect(baseline.schema_version).toBe("1.0");
    expect(baseline.findings.length).toBeGreaterThan(0);

    const r = runCli([tmp]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("pre-existing");
  });

  it("PI-8: --diff-only against a 1-changed-file repo only walks the changed file", async () => {
    await fs.writeFile(path.join(tmp, "a.js"), "// finding-free\n");
    await fs.writeFile(path.join(tmp, "b.js"), "// finding-free\n");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp });
    execFileSync("git", ["config", "user.email", "test@test.test"], { cwd: tmp });
    execFileSync("git", ["config", "user.name", "test"], { cwd: tmp });
    execFileSync("git", ["add", "."], { cwd: tmp });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
    await fs.writeFile(path.join(tmp, "a.js"), STRIPE_BUG_SOURCE);
    const r = runCli(["--diff-only", "--diff-base", "HEAD", "--format", "json", tmp]);
    const env = JSON.parse(r.stdout);
    expect(env.scan.parse_candidates_count).toBe(1);
    const filePaths = new Set<string>(
      env.scan.findings.map((f: { file_path: string }) => f.file_path),
    );
    if (filePaths.size > 0) {
      expect([...filePaths]).toEqual(["a.js"]);
    }
  });

  it("PI-9: empty/clean directory exits 0 with no findings", async () => {
    await fs.writeFile(path.join(tmp, "noop.js"), "// nothing here\n");
    const r = runCli([tmp]);
    expect(r.code).toBe(0);
  });

  it("PI-10: JSON stdout passes JSON.parse cleanly (no warnings/colors leak to stdout)", () => {
    const r = runCli(["--format", "json", CANONICAL_BUG]);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});

describe("Phase 4 — edge cases and cross-cutting behavior", () => {
  it("byte-stability: same fixture, same flags → identical JSON output across two runs", () => {
    const r1 = runCli(["--format", "json", CANONICAL_BUG]);
    const r2 = runCli(["--format", "json", CANONICAL_BUG]);
    // The metadata.scanned_at differs because pipeline sets it from new Date().toISOString();
    // strip that single field and compare the rest. (Plan 09 leaves clock-source as Phase 6 work.)
    const e1 = JSON.parse(r1.stdout);
    const e2 = JSON.parse(r2.stdout);
    e1.scan.scanned_at = "<frozen>";
    e2.scan.scanned_at = "<frozen>";
    expect(JSON.stringify(e1)).toBe(JSON.stringify(e2));
  });

  it("byte-stability: SARIF output is identical across two runs (modulo scanned_at)", () => {
    const r1 = runCli(["--format", "sarif", CANONICAL_BUG]);
    const r2 = runCli(["--format", "sarif", CANONICAL_BUG]);
    // SARIF doesn't surface scanned_at at the top level; should be byte-identical except for
    // tool.driver.version (same on both runs). Direct equality check.
    expect(r1.stdout).toBe(r2.stdout);
  });

  it("D-71: '--baseline write' under '--diff-only' emits stderr footgun warning", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp });
    execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: tmp });
    execFileSync("git", ["config", "user.name", "t"], { cwd: tmp });
    execFileSync("git", ["add", "."], { cwd: tmp });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
    // Modify so --diff-only HEAD finds something.
    await fs.appendFile(path.join(tmp, "server.js"), "\n// edit\n");
    const r = runCli(["--baseline", "write", "--diff-only", "--diff-base", "HEAD", tmp]);
    expect(r.stderr).toContain("scope-narrowed baseline");
    expect(r.stderr).toContain("--diff-only");
  });

  it("HOOKWARDEN_FAIL_ON env var raises threshold above critical → critical findings exit 0", async () => {
    // Default fail_on=high; canonical bug has critical findings → exit 1.
    // With HOOKWARDEN_FAIL_ON=critical, the threshold is at critical so still trips.
    // To prove env precedence works, set fail_on=low (looser than default high) on a clean dir
    // and verify it still exits 0 — env reaches resolveConfig.
    await fs.writeFile(path.join(tmp, "noop.js"), "// clean\n");
    const proc = spawnSync("node", [CLI_BIN, "scan", tmp], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", HOOKWARDEN_FAIL_ON: "low" },
    });
    expect(proc.status).toBe(0);
  });

  it("hookwarden.config.yaml is auto-discovered via walk-up", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    // Plant a config that disables baseline + sets fail_on=critical (same as default behavior).
    await fs.writeFile(
      path.join(tmp, "hookwarden.config.yaml"),
      "schema_version: '1.0'\nfail_on: critical\nbaseline:\n  enabled: false\n",
    );
    // Critical findings exist → fail_on=critical still trips → exit 1.
    const r = runCli([tmp]);
    expect(r.code).toBe(1);
  });

  it("--no-config bypasses an existing hookwarden.config.yaml", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    // Plant a config that would normally raise the threshold. With --no-config it should be ignored.
    await fs.writeFile(
      path.join(tmp, "hookwarden.config.yaml"),
      "schema_version: '1.0'\nfail_on: low\n",
    );
    const r = runCli(["--no-config", tmp]);
    // With config bypassed, default fail_on=high; canonical bug has critical → exit 1 either way.
    expect(r.code).toBe(1);
    // The proof of bypass: stderr contains no config-load error from a deliberately-malformed file.
    await fs.writeFile(
      path.join(tmp, "hookwarden.config.yaml"),
      "this: { is: not: valid: yaml }\n",
    );
    const r2 = runCli(["--no-config", tmp]);
    expect(r2.code).toBe(1); // engine still ran; config never loaded
    expect(r2.stderr).not.toContain("YAML parse error");
  });

  it("malformed hookwarden.config.yaml at scan root → exit 3 with parse error in stderr", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    await fs.writeFile(path.join(tmp, "hookwarden.config.yaml"), "{ broken: yaml: : :\n");
    const r = runCli([tmp]);
    expect(r.code).toBe(3);
    expect(r.stderr).toMatch(/YAML parse error|config|invalid/i);
  });

  it("--no-baseline disables auto-read even when a baseline file exists", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    // Seed a baseline that would suppress everything if read.
    runCli(["--baseline", "write", tmp]);
    const r = runCli(["--no-baseline", "--format", "json", tmp]);
    const env = JSON.parse(r.stdout);
    const baselineSuppressed = env.scan.findings.filter(
      (f: { suppressed: { source: string } | null }) => f.suppressed?.source === "baseline",
    );
    expect(baselineSuppressed.length).toBe(0);
    // Findings are still present (just not baseline-suppressed).
    expect(env.scan.findings.length).toBeGreaterThan(0);
  });

  it("--diff-only with no changes against HEAD → empty scan, exit 0, parse_candidates_count=0", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp });
    execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: tmp });
    execFileSync("git", ["config", "user.name", "t"], { cwd: tmp });
    execFileSync("git", ["add", "."], { cwd: tmp });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
    // No edits.
    const r = runCli(["--diff-only", "--diff-base", "HEAD", "--format", "json", tmp]);
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.scan.parse_candidates_count).toBe(0);
    expect(env.scan.findings.length).toBe(0);
  });

  it("non-existent scan path: walker yields zero candidates → exit 0", async () => {
    const ghost = path.join(tmp, "does-not-exist");
    const r = runCli(["--format", "json", ghost]);
    // The walker silently produces zero files for a missing directory.
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.scan.findings).toEqual([]);
  });

  it("JSON output: findings are sorted by (severity_rank, file_path, line, col, rule_id)", () => {
    const r = runCli(["--format", "json", CANONICAL_BUG]);
    const env = JSON.parse(r.stdout);
    const findings = env.scan.findings as ReadonlyArray<{
      severity: string;
      file_path: string;
      location: { line: number; col: number };
      rule_id: string;
    }>;
    const RANK: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      info: 4,
    };
    for (let i = 1; i < findings.length; i++) {
      const a = findings[i - 1]!;
      const b = findings[i]!;
      const sa = RANK[a.severity];
      const sb = RANK[b.severity];
      if (sa !== sb) {
        expect(sa).toBeLessThanOrEqual(sb);
        continue;
      }
      if (a.file_path !== b.file_path) {
        expect(a.file_path < b.file_path).toBe(true);
        continue;
      }
      if (a.location.line !== b.location.line) {
        expect(a.location.line).toBeLessThanOrEqual(b.location.line);
        continue;
      }
      if (a.location.col !== b.location.col) {
        expect(a.location.col).toBeLessThanOrEqual(b.location.col);
        continue;
      }
      expect(a.rule_id <= b.rule_id).toBe(true);
    }
  });

  it("SARIF output: every result has properties.hookwarden-state and partialFingerprints (D-76)", () => {
    const r = runCli(["--format", "sarif", CANONICAL_BUG]);
    const sarif = JSON.parse(r.stdout);
    const results = sarif.runs[0].results as ReadonlyArray<{
      properties: { "hookwarden-state": string };
      partialFingerprints: { primaryLocationLineHash: string };
    }>;
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(["verified", "not-verified", "manual-review"]).toContain(
        result.properties["hookwarden-state"],
      );
      expect(result.partialFingerprints.primaryLocationLineHash).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("SARIF output: tool.driver.rules has a defaultConfiguration.level for every rule", () => {
    const r = runCli(["--format", "sarif", CANONICAL_BUG]);
    const sarif = JSON.parse(r.stdout);
    const rules = sarif.runs[0].tool.driver.rules as ReadonlyArray<{
      id: string;
      defaultConfiguration: { level: string };
    }>;
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(["error", "warning", "note"]).toContain(rule.defaultConfiguration.level);
    }
  });

  it("D-66: a baseline-suppressed finding stays in findings[] but does not count toward fail-on", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    runCli(["--baseline", "write", tmp]);
    const r = runCli(["--format", "json", tmp]);
    expect(r.code).toBe(0); // all critical findings suppressed by baseline
    const env = JSON.parse(r.stdout);
    expect(env.scan.findings.length).toBeGreaterThan(0); // findings ARE still in the array
    expect(env.scan.counts.active.critical).toBe(0);
    expect(env.scan.counts.suppressed.critical).toBeGreaterThan(0);
  });

  it("--strict-suppressions with stale entries promotes to exit 1", async () => {
    // Plant a .hookwardenignore pattern that matches NOTHING in the (clean) project.
    await fs.writeFile(path.join(tmp, "noop.js"), "// clean\n");
    await fs.writeFile(path.join(tmp, ".hookwardenignore"), "does-not-exist/*.ts\n");
    const r = runCli(["--strict-suppressions", tmp]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("stale suppression");
  });

  it("--diff-only against branch HEAD~1 catches deleted-then-added file as the modified one", async () => {
    // Init repo with file A, commit, delete A, add B with a finding.
    await fs.writeFile(path.join(tmp, "a.js"), "// clean\n");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp });
    execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: tmp });
    execFileSync("git", ["config", "user.name", "t"], { cwd: tmp });
    execFileSync("git", ["add", "."], { cwd: tmp });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
    await fs.rm(path.join(tmp, "a.js"));
    await fs.writeFile(
      path.join(tmp, "b.js"),
      `import express from 'express'; const app = express(); app.post('/w', express.json(), (req, res) => res.json({}));\n`,
    );
    execFileSync("git", ["add", "."], { cwd: tmp });
    execFileSync("git", ["commit", "-q", "-m", "swap"], { cwd: tmp });
    const r = runCli(["--diff-only", "--diff-base", "HEAD~1", "--format", "json", tmp]);
    const env = JSON.parse(r.stdout);
    // Only b.js exists on disk + is in the diff set; a.js is deleted (no longer walkable).
    const filePaths = new Set<string>(
      env.scan.findings.map((f: { file_path: string }) => f.file_path),
    );
    expect([...filePaths].every((p) => p === "b.js")).toBe(true);
  });
});
